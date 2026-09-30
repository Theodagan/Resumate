package com.resumate.mcp.integration;

import com.resumate.mcp.service.PocketBaseClient;
import com.resumate.mcp.support.OAuthTestPropertiesInitializer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

@SpringBootTest
@ContextConfiguration(initializers = OAuthTestPropertiesInitializer.class)
class McpToolAccessIntegrationTest {
    @Autowired WebApplicationContext context;
    @MockitoBean PocketBaseClient pocketBaseClient;
    @MockitoBean JwtDecoder jwtDecoder;
    MockMvc mvc;

    @BeforeEach void setup() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        when(pocketBaseClient.findAiTokenByRawToken("resm_test"))
                .thenReturn(Optional.of(new PocketBaseClient.AiTokenRecord("token", "user-1", "label", "active",
                        Instant.now().plusSeconds(3600).toString(), "hash", "prefix")));
        when(pocketBaseClient.mcpPreferences("user-1"))
                .thenReturn(Map.of("id", "user-1", "mcpCvEnabled", true, "mcpMaterialsEnabled", false));
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder rpc(String message) {
        return post("/mcp").header("Authorization", "Bearer resm_test")
                .header("Accept", "application/json, text/event-stream")
                .contentType("application/json").content(message);
    }

    @Test void defaultDiscoveryHidesMaterialsAndDirectInvocationIsForbidden() throws Exception {
        var listing = mvc.perform(rpc("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}"))
                .andReturn().getResponse();
        assertThat(listing.getStatus()).isEqualTo(200);
        assertThat(listing.getContentAsString()).contains("listTemplates").doesNotContain("createProject");
        var forbidden = mvc.perform(rpc("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"createProject\",\"arguments\":{}}}"))
                .andReturn().getResponse();
        assertThat(forbidden.getStatus()).isEqualTo(403);
    }

    @Test void materialsOnlyAndAccountIntersection() throws Exception {
        when(pocketBaseClient.mcpPreferences("user-1"))
                .thenReturn(Map.of("id", "user-1", "mcpCvEnabled", true, "mcpMaterialsEnabled", true));
        var listing = mvc.perform(rpc("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}")
                .header("Resumate-Tool-Families", "materials")).andReturn().getResponse();
        assertThat(listing.getStatus()).isEqualTo(200);
        assertThat(listing.getContentAsString()).contains("createProject").doesNotContain("listTemplates");
        var forbidden = mvc.perform(rpc("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"listTemplates\",\"arguments\":{}}}")
                .header("Resumate-Tool-Families", "materials")).andReturn().getResponse();
        assertThat(forbidden.getStatus()).isEqualTo(403);
    }

    @Test void invalidHeaderIsRejected() throws Exception {
        var result = mvc.perform(rpc("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}")
                .header("Resumate-Tool-Families", "everything")).andReturn().getResponse();
        assertThat(result.getStatus()).isEqualTo(400);
    }

    @Test void oauthPrincipalUsesSameAccountLimits() throws Exception {
        when(jwtDecoder.decode("oauth-token")).thenReturn(Jwt.withTokenValue("oauth-token")
                .header("alg", "RS256").subject("user-1")
                .audience(List.of("https://mcp.example.test/mcp"))
                .claim("client_id", "client-1").build());
        var response = mvc.perform(post("/mcp").header("Authorization", "Bearer oauth-token")
                .header("Accept", "application/json, text/event-stream")
                .contentType("application/json")
                .content("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}"))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString()).contains("listTemplates").doesNotContain("createProject");
    }

    @Test void enabledMaterialToolWritesAsAuthenticatedOwner() throws Exception {
        when(pocketBaseClient.mcpPreferences("user-1"))
                .thenReturn(Map.of("id", "user-1", "mcpCvEnabled", true, "mcpMaterialsEnabled", true));
        when(pocketBaseClient.createMaterial(eq("skills"), eq("user-1"), anyMap()))
                .thenReturn(Map.of("id", "skill-1"));
        var result = mvc.perform(rpc("{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"createSkill\",\"arguments\":{\"request\":{\"data\":{\"name\":\"Java\"},\"userConfirmed\":true}}}}")
                .header("Resumate-Tool-Families", "materials")).andReturn().getResponse();
        assertThat(result.getStatus()).isEqualTo(200);
        assertThat(result.getContentAsString()).contains("skill-1");
        verify(pocketBaseClient).createMaterial(eq("skills"), eq("user-1"), anyMap());
    }
}
