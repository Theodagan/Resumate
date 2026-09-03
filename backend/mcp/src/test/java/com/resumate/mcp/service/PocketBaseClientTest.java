package com.resumate.mcp.service;

import com.resumate.mcp.config.PocketBaseProperties;
import com.resumate.mcp.service.PocketBaseClient.AiTokenRecord;
import com.resumate.mcp.service.PocketBaseClient.CreatedProfileRecord;
import com.resumate.mcp.service.PocketBaseClient.ProfileMaterialBundle;
import com.resumate.mcp.service.PocketBaseClient.TemplateDescriptor;
import com.resumate.mcp.service.PocketBaseClient.UpdatedProfileRecord;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PocketBaseClientTest {

    private MockWebServer mockWebServer;
    private PocketBaseClient client;

    @BeforeEach
    void setUp() throws IOException {
        mockWebServer = new MockWebServer();
        mockWebServer.start();

        PocketBaseProperties properties = new PocketBaseProperties(
                mockWebServer.url("/").toString(),
                "service@test.com",
                "password123"
        );

        RestClient.Builder restClientBuilder = RestClient.builder();
        client = new PocketBaseClient(properties, restClientBuilder);
    }

    @AfterEach
    void tearDown() throws IOException {
        mockWebServer.shutdown();
    }

    private void enqueueAuthResponse() {
        mockWebServer.enqueue(new MockResponse()
                .setBody("{\"token\":\"auth-token-123\"}")
                .setHeader("Content-Type", "application/json"));
    }

    private void enqueueJsonResponse(String body) {
        mockWebServer.enqueue(new MockResponse()
                .setBody(body)
                .setHeader("Content-Type", "application/json"));
    }

    @Test
    void resolveAvailableTemplates_returnsAllTemplates() {
        List<TemplateDescriptor> result = client.resolveAvailableTemplates();

        assertThat(result).hasSize(6);
        assertThat(result.stream().map(TemplateDescriptor::id).toList())
                .containsExactly("classic", "bento", "modern", "supa", "minimal", "affiche");
        assertThat(result.stream().map(TemplateDescriptor::description).toList())
                .containsExactly(
                        "Two-column CV with grouped experience, a dedicated contact panel, and categorized skills.",
                        "Visual grid-based resume with strong project and profile presentation.",
                        "Split-sidebar resume with timeline-style experience and card-based project highlights.",
                        "Clean, compact, print-first CV designed to fit into a single A4 page. Dynamic sizing, great for showcasing lots of projects.",
                        "Harvard-style single-column resume with inline contact details, restrained typography, and compact sections.",
                        "Two-page A4 landscape poster CV with a three-panel recto (profile, experience, projects) and a verso (visual universe, fit arguments), built on the Affiche design system."
                );
        assertThat(result.get(2).extraSchema()).extracting(PocketBaseClient.ExtraFieldDescriptor::id)
                .containsExactly("headline", "accentColor");
    }

    @Test
    void findAiTokenByRawToken_returnsToken_whenFound() throws InterruptedException {
        enqueueAuthResponse();

        String tokenJson = """
                {
                    "items": [{
                    "id": "tokenId",
                    "user": "userId",
                    "label": "test",
                    "status": "active",
                    "token_hash": "abc123",
                    "token_prefix": "abc"
                }]
                }
                """;
        enqueueJsonResponse(tokenJson);

        Optional<AiTokenRecord> result = client.findAiTokenByRawToken("some-token");

        assertThat(result).isPresent();
        assertThat(result.get().id()).isEqualTo("tokenId");
        assertThat(result.get().user()).isEqualTo("userId");

        RecordedRequest authRequest = mockWebServer.takeRequest();
        assertThat(authRequest.getPath()).isEqualTo("/api/collections/users/auth-with-password");
    }

    @Test
    void findAiTokenByRawToken_returnsEmpty_whenNotFound() {
        enqueueAuthResponse();
        enqueueJsonResponse("{\"items\": []}");

        Optional<AiTokenRecord> result = client.findAiTokenByRawToken("unknown-token");

        assertThat(result).isEmpty();
    }

    @Test
    void authenticateUser_returnsUserRecord() throws InterruptedException {
        enqueueJsonResponse("""
                {
                  "token": "user-token",
                  "record": {
                    "id": "userId",
                    "email": "user@example.com",
                    "firstName": "Alex",
                    "lastName": "Morgan"
                  }
                }
                """);

        Optional<PocketBaseClient.UserRecord> result = client.authenticateUser("user@example.com", "secret-password");

        assertThat(result).isPresent();
        assertThat(result.get().id()).isEqualTo("userId");
        assertThat(result.get().email()).isEqualTo("user@example.com");

        RecordedRequest authRequest = mockWebServer.takeRequest();
        assertThat(authRequest.getPath()).isEqualTo("/api/collections/users/auth-with-password");
        assertThat(authRequest.getBody().readUtf8()).contains("user@example.com", "secret-password");
    }

    @Test
    void authenticateUser_returnsEmptyForPocketBaseCredentialFailure() {
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(400)
                .setBody("{\"message\":\"Failed to authenticate.\"}")
                .setHeader("Content-Type", "application/json"));

        Optional<PocketBaseClient.UserRecord> result = client.authenticateUser("unknown@example.com", "wrong-password");

        assertThat(result).isEmpty();
    }

    @Test
    void loadProfileMaterial_returnsMaterialWithoutReadingUsers() throws InterruptedException {
        enqueueAuthResponse();
        String collectionResponse = "{\"items\": [{\"id\": \"test-id\", \"name\": \"test\"}]}";
        for (int i = 0; i < 6; i++) {
            enqueueJsonResponse(collectionResponse);
        }

        ProfileMaterialBundle bundle = client.loadProfileMaterial("userId");

        assertThat(bundle.skills()).extracting(record -> record.get("id")).containsExactly("test-id");

        assertThat(mockWebServer.takeRequest().getPath())
                .isEqualTo("/api/collections/users/auth-with-password");
        for (String collection : List.of("skills", "jobs", "projects", "achievements", "degrees", "hobbies")) {
            String path = mockWebServer.takeRequest().getPath();
            assertThat(path)
                    .startsWith("/api/collections/" + collection + "/records?")
                    .contains("filter=user%3D%22userId%22")
                    .doesNotContain("/api/collections/users/records");
        }
    }

    @Test
    void validateOwnedRecordIds_passes_whenAllIdsBelongToUser() {
        enqueueAuthResponse();
        enqueueJsonResponse("{\"id\":\"skill1\",\"user\":\"userId\"}");
        enqueueJsonResponse("{\"id\":\"skill2\",\"user\":\"userId\"}");

        client.validateOwnedRecordIds("skills", "userId", List.of("skill1", "skill2"));
    }

    @Test
    void validateOwnedRecordIds_throws_whenIdsDontMatch() {
        enqueueAuthResponse();
        enqueueJsonResponse("{\"id\":\"skill1\",\"user\":\"userId\"}");
        enqueueJsonResponse("{\"id\":\"skill2\",\"user\":\"other-user\"}");

        assertThatThrownBy(() -> client.validateOwnedRecordIds("skills", "userId", List.of("skill1", "skill2")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("One or more selected records do not belong to the API key owner.");
    }

    @Test
    void validateOwnedRecordIds_skips_whenIdsListIsNull() {
        client.validateOwnedRecordIds("skills", "userId", null);
    }

    @Test
    void validateOwnedRecordIds_skips_whenIdsListIsEmpty() {
        client.validateOwnedRecordIds("skills", "userId", List.of());
    }

    @Test
    void listCvProfilesForUser_filtersByOwnerAndSortsByMostRecent() throws InterruptedException {
        enqueueAuthResponse();
        enqueueJsonResponse("""
                {
                    "items": [{
                        "id": "profile1",
                        "slug": "classic--acme-dev-1",
                        "label": "Acme - Dev",
                        "profileName": "Acme Dev CV",
                        "template": "classic",
                        "public": true,
                        "user": "userId",
                        "updated_at": "2026-07-20 10:00:00.000Z"
                    }]
                }
                """);

        List<PocketBaseClient.CvProfileSummaryRecord> profiles = client.listCvProfilesForUser("userId");

        assertThat(profiles).hasSize(1);
        assertThat(profiles.get(0).id()).isEqualTo("profile1");
        assertThat(profiles.get(0).slug()).isEqualTo("classic--acme-dev-1");
        assertThat(profiles.get(0).label()).isEqualTo("Acme - Dev");
        assertThat(profiles.get(0).profileName()).isEqualTo("Acme Dev CV");
        assertThat(profiles.get(0).template()).isEqualTo("classic");
        assertThat(profiles.get(0).publicProfile()).isTrue();
        assertThat(profiles.get(0).updatedAt()).isEqualTo("2026-07-20 10:00:00.000Z");

        mockWebServer.takeRequest();
        RecordedRequest listRequest = mockWebServer.takeRequest();
        assertThat(listRequest.getPath())
                .startsWith("/api/collections/cv_profiles/records?")
                .contains("filter=user%3D%22userId%22");
        assertThat(listRequest.getRequestUrl().queryParameter("sort")).isEqualTo("-updated_at");
        assertThat(listRequest.getRequestUrl().queryParameter("perPage")).isEqualTo("200");
    }

    @Test
    void listCvProfilesForUser_returnsEmptyList_whenNoProfilesExist() {
        enqueueAuthResponse();
        enqueueJsonResponse("{\"items\": []}");

        assertThat(client.listCvProfilesForUser("userId")).isEmpty();
    }

    @Test
    void listCvProfilesForUser_escapesQuotesInUserId() throws InterruptedException {
        enqueueAuthResponse();
        enqueueJsonResponse("{\"items\": []}");

        client.listCvProfilesForUser("user\"Id");

        mockWebServer.takeRequest();
        RecordedRequest listRequest = mockWebServer.takeRequest();
        assertThat(listRequest.getRequestUrl().queryParameter("filter"))
                .isEqualTo("user=\"user\\\"Id\"");
    }

    @Test
    void createTailoredProfile_returnsCreatedRecord() throws InterruptedException {
        enqueueAuthResponse();
        enqueueJsonResponse("""
                {
                    "id": "profile123",
                    "slug": "classic--my-profile-1700000000000"
                }
                """);

        PocketBaseClient.CreateProfilePayload payload = new PocketBaseClient.CreateProfilePayload(
                "RTM - Infographiste Multimédia", "My Profile", "classic", "Summary",
                List.of("skill1"), List.of(), List.of(), List.of(), List.of(), List.of(), Map.of()
        );

        CreatedProfileRecord result = client.createTailoredProfile("userId", payload);

        assertThat(result.id()).isEqualTo("profile123");
        assertThat(result.slug()).isEqualTo("classic--my-profile-1700000000000");

        mockWebServer.takeRequest();
        RecordedRequest createRequest = mockWebServer.takeRequest();
        String createBody = createRequest.getBody().readUtf8();
        assertThat(createBody).contains("\"label\":\"RTM - Infographiste Multimédia\"");
        assertThat(createBody).contains("\"profileName\":\"My Profile\"");
        assertThat(createBody).contains("\"template\":\"classic\"");
        assertThat(createBody).contains("\"public\":true");
        assertThat(createBody).contains("\"user\":\"userId\"");
        assertThat(createBody).contains("\"extra\":{}");
    }

    @Test
    void createTailoredProfile_sendsExtraPayload() throws InterruptedException {
        enqueueAuthResponse();
        enqueueJsonResponse("""
                {
                    "id": "profile123",
                    "slug": "modern--my-profile-1700000000000"
                }
                """);

        PocketBaseClient.CreateProfilePayload payload = new PocketBaseClient.CreateProfilePayload(
                "Acme - Modern", "My Profile", "modern", "Summary",
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
                Map.of("modern", Map.of("headline", "Senior developer"))
        );

        client.createTailoredProfile("userId", payload);

        mockWebServer.takeRequest();
        RecordedRequest createRequest = mockWebServer.takeRequest();
        assertThat(createRequest.getBody().readUtf8()).contains("\"extra\":{\"modern\":{\"headline\":\"Senior developer\"}}");
    }

    @Test
    void createTailoredProfile_usesProfileFallbackSlug_whenProfileNameIsNull() throws InterruptedException {
        enqueueAuthResponse();
        enqueueJsonResponse("""
                {
                    "id": "profile123",
                    "slug": "classic--profile-1700000000000"
                }
                """);

        PocketBaseClient.CreateProfilePayload payload = new PocketBaseClient.CreateProfilePayload(
                "Acme - Classic", null, "classic", "Summary",
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), Map.of()
        );

        client.createTailoredProfile("userId", payload);

        mockWebServer.takeRequest();
        RecordedRequest createRequest = mockWebServer.takeRequest();
        assertThat(createRequest.getBody().readUtf8()).contains("\"slug\":\"classic--profile-");
    }

    @Test
    void createTailoredProfile_throwsWithPocketBaseDetails_whenCreateFails() {
        enqueueAuthResponse();
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(400)
                .setBody("{\"message\":\"Failed to create record.\",\"data\":{\"details\":\"create rule failure\"}}")
                .setHeader(HttpHeaders.CONTENT_TYPE, "application/json"));

        PocketBaseClient.CreateProfilePayload payload = new PocketBaseClient.CreateProfilePayload(
                "Acme - Classic", "My Profile", "classic", "Summary",
                List.of("skill1"), List.of(), List.of(), List.of(), List.of(), List.of(), Map.of()
        );

        assertThatThrownBy(() -> client.createTailoredProfile("userId", payload))
                .isInstanceOf(RestClientResponseException.class)
                .hasMessageContaining("400 Bad Request")
                .hasMessageContaining("Failed to create record");
    }

    @Test
    void markAiTokenUsed_sendsPatchRequest() throws InterruptedException {
        enqueueAuthResponse();
        mockWebServer.enqueue(new MockResponse().setResponseCode(200));

        client.markAiTokenUsed("token123");

        RecordedRequest authRequest = mockWebServer.takeRequest();
        assertThat(authRequest.getPath()).isEqualTo("/api/collections/users/auth-with-password");

        RecordedRequest patchRequest = mockWebServer.takeRequest();
        assertThat(patchRequest.getMethod()).isEqualTo("PATCH");
        assertThat(patchRequest.getPath()).isEqualTo("/api/collections/ai_tokens/records/token123");
        assertThat(patchRequest.getBody().readUtf8()).contains("lastUsedAt");
    }

    @Test
    void createOAuthClient_hashesClientSecretAndSendsPayload() throws InterruptedException {
        enqueueAuthResponse();
        enqueueJsonResponse("""
                {
                    "id": "clientRecordId",
                    "client_id": "claude-ai",
                    "client_secret_hash": "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b",
                    "client_name": "claude.ai",
                    "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
                    "grant_types": ["authorization_code", "refresh_token"],
                    "scopes": ["mcp"],
                    "token_settings": {"accessTokenTtlSeconds": 3600}
                }
                """);

        PocketBaseClient.OAuthClientRecord result = client.createOAuthClient(new PocketBaseClient.OAuthClientPayload(
                "claude-ai",
                "secret",
                "claude.ai",
                List.of("https://claude.ai/api/mcp/auth_callback"),
                List.of("authorization_code", "refresh_token"),
                List.of("mcp"),
                Map.of("accessTokenTtlSeconds", 3600),
                null
        ));

        assertThat(result.id()).isEqualTo("clientRecordId");
        assertThat(result.clientId()).isEqualTo("claude-ai");
        assertThat(result.clientSecretHash()).isEqualTo("2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b");

        mockWebServer.takeRequest();
        RecordedRequest createRequest = mockWebServer.takeRequest();
        String body = createRequest.getBody().readUtf8();
        assertThat(createRequest.getMethod()).isEqualTo("POST");
        assertThat(createRequest.getPath()).isEqualTo("/api/collections/oauth_clients/records");
        assertThat(body).contains("\"client_id\":\"claude-ai\"");
        assertThat(body).contains("\"client_secret_hash\":\"2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b\"");
        assertThat(body).doesNotContain(":\"secret\"");
    }

    @Test
    void findOAuthClientByClientId_queriesClientCollection() throws InterruptedException {
        enqueueAuthResponse();
        enqueueJsonResponse("""
                {"items": [{"id": "clientRecordId", "client_id": "claude-ai", "client_name": "claude.ai"}]}
                """);

        Optional<PocketBaseClient.OAuthClientRecord> result = client.findOAuthClientByClientId("claude-ai");

        assertThat(result).isPresent();
        assertThat(result.get().id()).isEqualTo("clientRecordId");

        mockWebServer.takeRequest();
        RecordedRequest listRequest = mockWebServer.takeRequest();
        assertThat(listRequest.getPath()).contains("/api/collections/oauth_clients/records");
        assertThat(listRequest.getPath()).contains("client_id%3D%22claude-ai%22");
    }

    @Test
    void updateAndDeleteOAuthClient_useExpectedCollectionRoutes() throws InterruptedException {
        enqueueAuthResponse();
        enqueueJsonResponse("{" +
                "\"id\":\"clientRecordId\"," +
                "\"client_id\":\"claude-ai\"," +
                "\"client_name\":\"Claude AI\"" +
                "}");
        mockWebServer.enqueue(new MockResponse().setResponseCode(204));

        client.updateOAuthClient("clientRecordId", new PocketBaseClient.OAuthClientPayload(
                "claude-ai", null, "Claude AI", List.of(), List.of(), List.of(), Map.of(), null
        ));
        client.deleteOAuthClient("clientRecordId");

        mockWebServer.takeRequest();
        RecordedRequest updateRequest = mockWebServer.takeRequest();
        RecordedRequest deleteRequest = mockWebServer.takeRequest();
        assertThat(updateRequest.getMethod()).isEqualTo("PATCH");
        assertThat(updateRequest.getPath()).isEqualTo("/api/collections/oauth_clients/records/clientRecordId");
        assertThat(deleteRequest.getMethod()).isEqualTo("DELETE");
        assertThat(deleteRequest.getPath()).isEqualTo("/api/collections/oauth_clients/records/clientRecordId");
    }

    @Test
    void createOAuthAuthorization_hashesCodeAndRefreshToken() throws InterruptedException {
        enqueueAuthResponse();
        enqueueJsonResponse("""
                {
                    "id": "authRecordId",
                    "user": "userId",
                    "client_id": "claude-ai",
                    "scopes": ["mcp"],
                    "auth_code_hash": "0b127c6413fd5bda549721cd7742193000cc14ded4a3128e95984b780171f0c5",
                    "refresh_token_hash": "0eb17643d4e9261163783a420859c92c7d212fa9624106a12b510afbec266120",
                    "access_token_jti": "jti-123",
                    "status": "active",
                    "state": {"id": "sas-auth-id"},
                    "consent": {"scope": "mcp"}
                }
                """);

        PocketBaseClient.OAuthAuthorizationRecord result = client.createOAuthAuthorization(new PocketBaseClient.OAuthAuthorizationPayload(
                "userId",
                "claude-ai",
                List.of("mcp"),
                "auth-code",
                "refresh-token",
                "jti-123",
                null,
                "active",
                Map.of("id", "sas-auth-id"),
                Map.of("scope", "mcp")
        ));

        assertThat(result.id()).isEqualTo("authRecordId");
        assertThat(result.authCodeHash()).isEqualTo("0b127c6413fd5bda549721cd7742193000cc14ded4a3128e95984b780171f0c5");
        assertThat(result.refreshTokenHash()).isEqualTo("0eb17643d4e9261163783a420859c92c7d212fa9624106a12b510afbec266120");

        mockWebServer.takeRequest();
        RecordedRequest createRequest = mockWebServer.takeRequest();
        String body = createRequest.getBody().readUtf8();
        assertThat(createRequest.getMethod()).isEqualTo("POST");
        assertThat(createRequest.getPath()).isEqualTo("/api/collections/oauth_authorizations/records");
        assertThat(body).contains("\"auth_code_hash\":\"0b127c6413fd5bda549721cd7742193000cc14ded4a3128e95984b780171f0c5\"");
        assertThat(body).contains("\"refresh_token_hash\":\"0eb17643d4e9261163783a420859c92c7d212fa9624106a12b510afbec266120\"");
        assertThat(body).doesNotContain("auth-code");
        assertThat(body).doesNotContain("refresh-token");
    }

    @Test
    void findOAuthAuthorizationByTokens_queriesHashedFields() throws InterruptedException {
        enqueueAuthResponse();
        enqueueJsonResponse("{" +
                "\"items\":[{\"id\":\"authByCode\",\"auth_code_hash\":\"0b127c6413fd5bda549721cd7742193000cc14ded4a3128e95984b780171f0c5\"}]" +
                "}");
        enqueueJsonResponse("{" +
                "\"items\":[{\"id\":\"authByRefresh\",\"refresh_token_hash\":\"0eb17643d4e9261163783a420859c92c7d212fa9624106a12b510afbec266120\"}]" +
                "}");

        Optional<PocketBaseClient.OAuthAuthorizationRecord> byCode = client.findOAuthAuthorizationByAuthCode("auth-code");
        Optional<PocketBaseClient.OAuthAuthorizationRecord> byRefresh = client.findOAuthAuthorizationByRefreshToken("refresh-token");

        assertThat(byCode).isPresent();
        assertThat(byRefresh).isPresent();

        mockWebServer.takeRequest();
        RecordedRequest codeRequest = mockWebServer.takeRequest();
        RecordedRequest refreshRequest = mockWebServer.takeRequest();
        assertThat(codeRequest.getPath()).contains("auth_code_hash%3D%220b127c6413fd5bda549721cd7742193000cc14ded4a3128e95984b780171f0c5%22");
        assertThat(refreshRequest.getPath()).contains("refresh_token_hash%3D%220eb17643d4e9261163783a420859c92c7d212fa9624106a12b510afbec266120%22");
    }

    @Test
    void updateAndDeleteOAuthAuthorization_useExpectedCollectionRoutes() throws InterruptedException {
        enqueueAuthResponse();
        enqueueJsonResponse("{" +
                "\"id\":\"authRecordId\"," +
                "\"user\":\"userId\"," +
                "\"client_id\":\"claude-ai\"," +
                "\"status\":\"revoked\"" +
                "}");
        mockWebServer.enqueue(new MockResponse().setResponseCode(204));

        client.updateOAuthAuthorization("authRecordId", new PocketBaseClient.OAuthAuthorizationPayload(
                "userId", "claude-ai", List.of("mcp"), null, null, null, null, "revoked", Map.of("id", "sas-auth-id"), Map.of()
        ));
        client.deleteOAuthAuthorization("authRecordId");

        mockWebServer.takeRequest();
        RecordedRequest updateRequest = mockWebServer.takeRequest();
        RecordedRequest deleteRequest = mockWebServer.takeRequest();
        assertThat(updateRequest.getMethod()).isEqualTo("PATCH");
        assertThat(updateRequest.getPath()).isEqualTo("/api/collections/oauth_authorizations/records/authRecordId");
        assertThat(deleteRequest.getMethod()).isEqualTo("DELETE");
        assertThat(deleteRequest.getPath()).isEqualTo("/api/collections/oauth_authorizations/records/authRecordId");
    }

    @Test
    void updateCvProfile_sendsPatchToRecordEndpoint() throws InterruptedException {
        enqueueAuthResponse();
        enqueueJsonResponse("""
                {
                    "id": "profile-42",
                    "slug": "classic--updated-profile-42"
                }
                """);

        Map<String, Object> patchBody = new java.util.LinkedHashMap<>();
        patchBody.put("label", "Updated Label");
        patchBody.put("professionalSummary", "Updated summary text");
        patchBody.put("public", false);

        UpdatedProfileRecord result = client.updateCvProfile("profile-42", patchBody);

        assertThat(result.id()).isEqualTo("profile-42");
        assertThat(result.slug()).isEqualTo("classic--updated-profile-42");

        mockWebServer.takeRequest(); // service-user auth
        RecordedRequest updateRequest = mockWebServer.takeRequest();

        assertThat(updateRequest.getMethod()).isEqualTo("PATCH");
        assertThat(updateRequest.getPath())
                .isEqualTo("/api/collections/cv_profiles/records/profile-42");
        assertThat(updateRequest.getHeader(HttpHeaders.CONTENT_TYPE))
                .isEqualTo("application/json");

        String body = updateRequest.getBody().readUtf8();
        assertThat(body).contains("\"label\":\"Updated Label\"");
        assertThat(body).contains("\"professionalSummary\":\"Updated summary text\"");
        assertThat(body).contains("\"public\":false");
    }

    @Test
    void serviceUserToken_throws_whenCredentialsNotConfigured() {
        PocketBaseProperties badProperties = new PocketBaseProperties(
                "http://localhost:8090", null, null
        );
        PocketBaseClient badClient = new PocketBaseClient(badProperties, RestClient.builder());

        assertThatThrownBy(() -> badClient.findAiTokenByRawToken("token"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("PocketBase MCP service-user credentials are not configured.");
    }

    // ==================== findProfileBySlugOrId tests ====================

    @Test
    void findProfileBySlugOrId_findsProfileBySlug() throws IOException {
        enqueueAuthResponse();

        String profileJson = """
                {"items": [{"id":"profile123","slug":"test-slug","user":"user123","template":"classic"}]}
                """;
        enqueueJsonResponse(profileJson);

        PocketBaseClient.CvProfileRecord result = client.findProfileBySlugOrId("test-slug");

        assertThat(result).isNotNull();
        assertThat(result.id()).isEqualTo("profile123");
        assertThat(result.slug()).isEqualTo("test-slug");

        try {
            // Skip auth request, get the actual request
            mockWebServer.takeRequest(); // auth request
            RecordedRequest request = mockWebServer.takeRequest();
            assertThat(request.getMethod()).isEqualTo("GET");
            assertThat(request.getPath()).startsWith("/api/collections/cv_profiles/records");
            assertThat(request.getHeader("Authorization")).isNotNull();
            assertThat(request.getRequestUrl().queryParameter("filter")).isEqualTo("(slug=\"test-slug\"||id=\"test-slug\")");
            assertThat(request.getRequestUrl().queryParameter("perPage")).isEqualTo("1");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @Test
    void findProfileBySlugOrId_findsProfileById() throws IOException {
        enqueueAuthResponse();

        String profileJson = """
                {"items": [{"id":"profile456","slug":"other-slug","user":"user456","template":"modern"}]}
                """;
        enqueueJsonResponse(profileJson);

        PocketBaseClient.CvProfileRecord result = client.findProfileBySlugOrId("profile456");

        assertThat(result).isNotNull();
        assertThat(result.id()).isEqualTo("profile456");

        try {
            mockWebServer.takeRequest(); // auth request
            RecordedRequest request = mockWebServer.takeRequest();
            assertThat(request.getRequestUrl().queryParameter("filter")).isEqualTo("(slug=\"profile456\"||id=\"profile456\")");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @Test
    void findProfileBySlugOrId_returnsNull_whenNoProfileFound() throws IOException {
        enqueueAuthResponse();
        enqueueJsonResponse("{\"items\": []}");

        PocketBaseClient.CvProfileRecord result = client.findProfileBySlugOrId("non-existent");

        assertThat(result).isNull();

        try {
            mockWebServer.takeRequest(); // auth request
            RecordedRequest request = mockWebServer.takeRequest();
            assertThat(request.getRequestUrl().queryParameter("filter")).isEqualTo("(slug=\"non-existent\"||id=\"non-existent\")");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @Test
    void findProfileBySlugOrId_handlesEmptyResponse() throws IOException {
        enqueueAuthResponse();
        enqueueJsonResponse("{}");

        PocketBaseClient.CvProfileRecord result = client.findProfileBySlugOrId("test");

        // When response is empty object, items() will be null, so result should be null
        assertThat(result).isNull();
    }

    @Test
    void findProfileBySlugOrId_escapesSpecialCharactersInFilter() throws IOException {
        enqueueAuthResponse();

        String profileJson = """
                {"items": [{"id":"profile789","slug":"test\\\"slug","user":"user789","template":"classic"}]}
                """;
        enqueueJsonResponse(profileJson);

        PocketBaseClient.CvProfileRecord result = client.findProfileBySlugOrId("test\"slug");

        assertThat(result).isNotNull();
        assertThat(result.slug()).isEqualTo("test\"slug");

        try {
            mockWebServer.takeRequest(); // auth request
            RecordedRequest request = mockWebServer.takeRequest();
            // Verify the filter contains escaped quotes
            assertThat(request.getRequestUrl().queryParameter("filter")).contains("\\\"");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
