package com.resumate.mcp.tool;

import com.resumate.mcp.security.McpPrincipal;
import com.resumate.mcp.service.PocketBaseClient;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class MaterialMcpTools {
    private static final String RULE = "Create authentic source material from the user's real experience, never invent facts or tailor source records to a job listing. Ask the user before writing, then set userConfirmed=true only after explicit approval. ";
    private static final Map<String, Set<String>> FIELDS = Map.of(
            "projects", Set.of("name", "description", "url", "date", "type", "file", "achievements", "sortOrder"),
            "achievements", Set.of("title", "description", "sortOrder"),
            "skills", Set.of("name", "category", "type", "level", "sortOrder"),
            "jobs", Set.of("label", "company", "position", "startDate", "endDate", "responsibilities", "location", "sortOrder", "type", "skills", "projects", "achievements"),
            "degrees", Set.of("title", "school", "year", "level", "sortOrder"),
            "hobbies", Set.of("name", "description", "sortOrder"));
    private static final Map<String, String> REQUIRED = Map.of(
            "projects", "name", "achievements", "title", "skills", "name", "jobs", "label",
            "degrees", "title", "hobbies", "name");
    private final PocketBaseClient client;

    public MaterialMcpTools(PocketBaseClient client) { this.client = client; }

    public record CreateRequest(
            @ToolParam(description = "Material fields for this record type.") Map<String, Object> data,
            @ToolParam(description = "True only after the user explicitly approves this exact write.") Boolean userConfirmed) {}
    public record UpdateRequest(
            @ToolParam(description = "ID of an existing record owned by the authenticated user.") String id,
            @ToolParam(description = "Only the fields to change; omitted fields remain unchanged.") Map<String, Object> data,
            @ToolParam(description = "True only after the user explicitly approves this exact write.") Boolean userConfirmed) {}

    @Tool(description = RULE + "Create a project with a real name and optional description, URL, date, type, related achievement IDs or sort order.")
    public Map<String, Object> createProject(CreateRequest request) { return create("projects", request); }
    @Tool(description = RULE + "Update a user-owned project by ID.")
    public Map<String, Object> updateProject(UpdateRequest request) { return update("projects", request); }
    @Tool(description = RULE + "Create a real achievement with a title.")
    public Map<String, Object> createAchievement(CreateRequest request) { return create("achievements", request); }
    @Tool(description = RULE + "Update a user-owned achievement by ID.")
    public Map<String, Object> updateAchievement(UpdateRequest request) { return update("achievements", request); }
    @Tool(description = RULE + "Create a real skill with a name.")
    public Map<String, Object> createSkill(CreateRequest request) { return create("skills", request); }
    @Tool(description = RULE + "Update a user-owned skill by ID.")
    public Map<String, Object> updateSkill(UpdateRequest request) { return update("skills", request); }
    @Tool(description = RULE + "Create a real job with label, company, position, startDate and type.")
    public Map<String, Object> createJob(CreateRequest request) { return create("jobs", request); }
    @Tool(description = RULE + "Update a user-owned job by ID.")
    public Map<String, Object> updateJob(UpdateRequest request) { return update("jobs", request); }
    @Tool(description = RULE + "Create a real degree with a title.")
    public Map<String, Object> createDegree(CreateRequest request) { return create("degrees", request); }
    @Tool(description = RULE + "Update a user-owned degree by ID.")
    public Map<String, Object> updateDegree(UpdateRequest request) { return update("degrees", request); }
    @Tool(description = RULE + "Create a real hobby with a name.")
    public Map<String, Object> createHobby(CreateRequest request) { return create("hobbies", request); }
    @Tool(description = RULE + "Update a user-owned hobby by ID.")
    public Map<String, Object> updateHobby(UpdateRequest request) { return update("hobbies", request); }

    private Map<String, Object> create(String collection, CreateRequest request) {
        Map<String, Object> data = validated(collection, request == null ? null : request.data(),
                request == null ? null : request.userConfirmed(), true);
        return summary(collection, client.createMaterial(collection, principal().userId(), data));
    }

    private Map<String, Object> update(String collection, UpdateRequest request) {
        Map<String, Object> data = validated(collection, request == null ? null : request.data(),
                request == null ? null : request.userConfirmed(), false);
        return summary(collection, client.updateMaterial(collection, principal().userId(), request.id(), data));
    }

    private static Map<String, Object> validated(String collection, Map<String, Object> data,
                                                   Boolean confirmed, boolean create) {
        if (!Boolean.TRUE.equals(confirmed)) throw new IllegalArgumentException("Explicit user confirmation is required for material writes.");
        if (data == null || data.isEmpty()) throw new IllegalArgumentException("Material data is required.");
        if (!FIELDS.get(collection).containsAll(data.keySet())) throw new IllegalArgumentException("Unsupported material field.");
        if (create && (!(data.get(REQUIRED.get(collection)) instanceof String required)
                || !StringUtils.hasText(required))) {
            throw new IllegalArgumentException("A " + REQUIRED.get(collection) + " is required.");
        }
        if (create && "jobs".equals(collection)) {
            for (String field : List.of("company", "position", "startDate", "type")) {
                if (!(data.get(field) instanceof String value) || !StringUtils.hasText(value)) {
                    throw new IllegalArgumentException("Job " + field + " is required.");
                }
            }
        }
        for (Object value : data.values()) {
            if (value instanceof String text && text.toLowerCase(java.util.Locale.ROOT)
                    .matches("(?s).*(job listing|job description|tailor|specific opportunity|job posting|job requirement|job ad|hiring for).*")) {
                throw new IllegalArgumentException("Source material tailored to job listings is not allowed.");
            }
        }
        return new LinkedHashMap<>(data);
    }

    private static McpPrincipal principal() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof McpPrincipal principal)) {
            throw new IllegalStateException("An authenticated MCP account is required.");
        }
        return principal;
    }

    private static Map<String, Object> summary(String collection, Map<String, Object> record) {
        if (record == null || !(record.get("id") instanceof String id)) {
            throw new IllegalStateException("PocketBase material response is missing its ID.");
        }
        return Map.of("id", id, "type", collection);
    }
}
