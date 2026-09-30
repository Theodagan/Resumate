package com.resumate.mcp.security;

import com.resumate.mcp.service.PocketBaseClient;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class McpToolAccessTest {
    PocketBaseClient client = mock(PocketBaseClient.class);
    McpToolAccess access = new McpToolAccess(client);

    @Test void legacyDefaultsAndClientNarrowing() {
        when(client.mcpPreferences("owner")).thenReturn(Map.of("id", "owner"));
        assertThat(access.resolve("owner", null, false)).isEqualTo(new McpToolAccess.Access(true, false));
        assertThat(access.resolve("owner", "materials", false)).isEqualTo(new McpToolAccess.Access(false, false));
        assertThat(access.resolve("owner", "both", false)).isEqualTo(new McpToolAccess.Access(true, false));
    }

    @Test void independentAccountSettingsAndInvalidHeaders() {
        when(client.mcpPreferences("owner"))
                .thenReturn(Map.of("id", "owner", "mcpCvEnabled", false, "mcpMaterialsEnabled", true));
        assertThat(access.resolve("owner", null, false)).isEqualTo(new McpToolAccess.Access(false, true));
        assertThat(access.resolve("owner", "cv", false)).isEqualTo(new McpToolAccess.Access(false, false));
        assertThatThrownBy(() -> access.resolve("owner", "all", false)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> access.resolve("owner", "both", true)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test void lookupFailuresDoNotGrantAccess() {
        when(client.mcpPreferences("owner")).thenThrow(new IllegalStateException("PocketBase offline"));
        assertThatThrownBy(() -> access.resolve("owner", null, false)).isInstanceOf(IllegalStateException.class);
    }
}
