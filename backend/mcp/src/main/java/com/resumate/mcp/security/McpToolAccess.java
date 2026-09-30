package com.resumate.mcp.security;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import com.resumate.mcp.service.PocketBaseClient;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.ReadListener;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;

@Component
public class McpToolAccess extends OncePerRequestFilter {
    public static final String HEADER = "Resumate-Tool-Families";
    private static final int MAX_REQUEST_BYTES = 2 * 1024 * 1024;
    private static final Set<String> CV_TOOLS = Set.of(
            "listTemplates", "whoAmI", "listProfileMaterial", "listCvProfiles", "createTailoredCvProfile", "updateCvProfile");
    private static final Set<String> MATERIAL_TOOLS = Set.of(
            "createProject", "updateProject", "createAchievement", "updateAchievement",
            "createSkill", "updateSkill", "createJob", "updateJob",
            "createDegree", "updateDegree", "createHobby", "updateHobby");
    private final PocketBaseClient pocketBaseClient;
    private final ObjectMapper mapper = new ObjectMapper();

    public McpToolAccess(PocketBaseClient pocketBaseClient) {
        this.pocketBaseClient = pocketBaseClient;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !"POST".equals(request.getMethod()) || !request.getRequestURI().equals("/mcp");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        // The stateless WebMVC transport handles requests synchronously. Preserve the request body
        // and filter only the JSON-RPC tools/list response; all other MCP messages pass through.
        byte[] body = request.getInputStream().readNBytes(MAX_REQUEST_BYTES + 1);
        if (body.length > MAX_REQUEST_BYTES) {
            response.sendError(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
            return;
        }
        HttpServletRequest wrapped = new ReplayRequest(request, body);
        JsonNode rpc;
        try {
            rpc = mapper.readTree(body);
        } catch (RuntimeException ex) {
            chain.doFilter(wrapped, response);
            return;
        }
        String method = rpc.path("method").asText();
        if (!"tools/list".equals(method) && !"tools/call".equals(method)) {
            chain.doFilter(wrapped, response);
            return;
        }
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof McpPrincipal principal)) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }
        Access access;
        try {
            access = resolve(principal.userId(), request.getHeader(HEADER),
                    java.util.Collections.list(request.getHeaders(HEADER)).size() > 1);
        } catch (IllegalArgumentException ex) {
            response.sendError(HttpServletResponse.SC_BAD_REQUEST, ex.getMessage());
            return;
        } catch (RuntimeException ex) {
            response.sendError(HttpServletResponse.SC_SERVICE_UNAVAILABLE, "MCP preferences unavailable.");
            return;
        }
        if ("tools/call".equals(method)) {
            String name = rpc.path("params").path("name").asText();
            if (!allowed(access, name)) {
                response.sendError(HttpServletResponse.SC_FORBIDDEN, "MCP tool family is disabled.");
                return;
            }
            chain.doFilter(wrapped, response);
            return;
        }
        ContentCachingResponseWrapper capture = new ContentCachingResponseWrapper(response);
        chain.doFilter(wrapped, capture);
        byte[] result = capture.getContentAsByteArray();
        if (capture.getStatus() == 200 && result.length > 0) {
            JsonNode json = mapper.readTree(result);
            JsonNode tools = json.path("result").path("tools");
            if (tools.isArray()) {
                ArrayNode filtered = mapper.createArrayNode();
                for (JsonNode tool : tools) {
                    if (allowed(access, tool.path("name").asText())) filtered.add(tool);
                }
                ((tools.jackson.databind.node.ObjectNode) json.path("result")).set("tools", filtered);
                byte[] replaced = mapper.writeValueAsBytes(json);
                capture.resetBuffer();
                capture.getOutputStream().write(replaced);
            }
        }
        capture.copyBodyToResponse();
    }

    public Access resolve(String userId, String selection, boolean duplicateHeader) {
        if (duplicateHeader || (selection != null && !Set.of("cv", "materials", "both").contains(selection))) {
            throw new IllegalArgumentException("Invalid Resumate-Tool-Families header.");
        }
        Map<String, Object> user = pocketBaseClient.mcpPreferences(userId);
        // Legacy records have no fields. A failed lookup must never use these defaults.
        boolean cv = !Boolean.FALSE.equals(user.get("mcpCvEnabled"));
        boolean materials = Boolean.TRUE.equals(user.get("mcpMaterialsEnabled"));
        return new Access(cv && !"materials".equals(selection), materials && !"cv".equals(selection));
    }

    private static boolean allowed(Access access, String name) {
        return (CV_TOOLS.contains(name) && access.cv()) || (MATERIAL_TOOLS.contains(name) && access.materials());
    }

    public record Access(boolean cv, boolean materials) {}

    private static final class ReplayRequest extends HttpServletRequestWrapper {
        private final byte[] body;

        ReplayRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream input = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                public int read() { return input.read(); }
                public boolean isFinished() { return input.available() == 0; }
                public boolean isReady() { return true; }
                public void setReadListener(ReadListener listener) { throw new UnsupportedOperationException(); }
            };
        }

        @Override
        public java.io.BufferedReader getReader() {
            return new java.io.BufferedReader(new java.io.InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
        }
    }
}
