package com.resumate.mcp.tool;

import com.resumate.mcp.security.oauth.OAuthPrincipal;
import com.resumate.mcp.service.PocketBaseClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.Mockito.*;

class MaterialMcpToolsTest {
    PocketBaseClient client = mock(PocketBaseClient.class);
    MaterialMcpTools tools = new MaterialMcpTools(client);

    @AfterEach void cleanup() { SecurityContextHolder.clearContext(); }

    private void authenticate() {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(new OAuthPrincipal("owner", "test", "client"), null));
    }

    @Test void allSixTypesCreateForOAuthOwner() {
        authenticate();
        when(client.createMaterial(anyString(), eq("owner"), anyMap())).thenReturn(Map.of("id", "saved-id"));
        assertThat(tools.createProject(new MaterialMcpTools.CreateRequest(Map.of("name", "Project"), true)).get("id")).isEqualTo("saved-id");
        tools.createAchievement(new MaterialMcpTools.CreateRequest(Map.of("title", "Achievement"), true));
        tools.createSkill(new MaterialMcpTools.CreateRequest(Map.of("name", "Skill"), true));
        tools.createJob(new MaterialMcpTools.CreateRequest(Map.of("label", "Job", "company", "Acme", "position", "Engineer", "startDate", "2024", "type", "freelance"), true));
        tools.createDegree(new MaterialMcpTools.CreateRequest(Map.of("title", "Degree"), true));
        tools.createHobby(new MaterialMcpTools.CreateRequest(Map.of("name", "Hobby"), true));
        verify(client, times(6)).createMaterial(anyString(), eq("owner"), anyMap());
    }

    @Test void allSixTypesUpdateForOAuthOwner() {
        authenticate();
        when(client.updateMaterial(anyString(), eq("owner"), eq("record"), anyMap())).thenReturn(Map.of("id", "record"));
        var request = new MaterialMcpTools.UpdateRequest("record", Map.of("sortOrder", 2), true);
        tools.updateProject(request); tools.updateAchievement(request); tools.updateSkill(request);
        tools.updateJob(request); tools.updateDegree(request); tools.updateHobby(request);
        verify(client, times(6)).updateMaterial(anyString(), eq("owner"), eq("record"), anyMap());
    }

    @Test void refusesUnconfirmedOrTailoredWritesAndOwnerFields() {
        authenticate();
        assertThatThrownBy(() -> tools.createSkill(new MaterialMcpTools.CreateRequest(Map.of("name", "Java"), false)))
                .hasMessageContaining("confirmation");
        assertThatThrownBy(() -> tools.createProject(new MaterialMcpTools.CreateRequest(Map.of("name", "tailor this to a job ad"), true)))
                .hasMessageContaining("tailored");
        assertThatThrownBy(() -> tools.createHobby(new MaterialMcpTools.CreateRequest(Map.of("name", "Hobby", "user", "other"), true)))
                .hasMessageContaining("Unsupported");
        verifyNoInteractions(client);
    }
}
