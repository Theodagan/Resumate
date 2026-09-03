package com.resumate.mcp.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.resumate.mcp.config.PocketBaseProperties;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

@Service
public class PocketBaseClient {

    private static final Logger logger = LoggerFactory.getLogger(PocketBaseClient.class);
    public static final String OAUTH_RECORD_TYPE_AUTHORIZATION = "authorization";
    public static final String OAUTH_RECORD_TYPE_CONSENT = "consent";

    private static final int CV_PROFILE_LIST_PAGE_SIZE = 200;

    private static final List<TemplateDescriptor> TEMPLATE_DESCRIPTORS = List.of(
            new TemplateDescriptor("classic", "Classic", "Two-column CV with grouped experience, a dedicated contact panel, and categorized skills.", List.of()),
            new TemplateDescriptor(
                    "bento",
                    "Bento",
                    "Visual grid-based resume with strong project and profile presentation.",
                    List.of(
                            new ExtraFieldDescriptor("qrCodeUrl", "QR code URL", "text", false, "URL encoded into the QR code on the bento card. Leave empty to auto-generate from the profile public route.", null, List.of())
                    )
            ),
            new TemplateDescriptor(
                    "modern",
                    "Modern",
                    "Split-sidebar resume with timeline-style experience and card-based project highlights.",
                    List.of(
                            new ExtraFieldDescriptor("headline", "Headline", "text", false, "Short role-focused line displayed near the candidate name.", null, List.of()),
                            new ExtraFieldDescriptor("accentColor", "Accent color", "color", false, "Main visual accent color for this profile.", null, List.of())
                    )
            ),
            new TemplateDescriptor(
                    "supa",
                    "Supa",
                    "Clean, compact, print-first CV designed to fit into a single A4 page. Dynamic sizing, great for showcasing lots of projects.",
                    List.of(
                            new ExtraFieldDescriptor("compactMode", "Compact mode", "boolean", false, "Whether the template should aggressively reduce spacing to fit more content on one A4 page.", null, List.of())
                    )
            ),
            new TemplateDescriptor("minimal", "Minimal", "Harvard-style single-column resume with inline contact details, restrained typography, and compact sections.", List.of()),
            new TemplateDescriptor("affiche", "Affiche", "Two-page A4 landscape poster CV with a three-panel recto (profile, experience, projects) and a verso (visual universe, fit arguments), built on the Affiche design system.", List.of())
    );

    private final PocketBaseProperties properties;
    private final RestClient restClient;
    private volatile String cachedServiceUserToken;
    private volatile Instant cachedServiceUserTokenExpiresAt;

    public PocketBaseClient(PocketBaseProperties properties, RestClient.Builder restClientBuilder) {
        this.properties = properties;
        this.restClient = restClientBuilder
                .baseUrl(trimTrailingSlash(properties.baseUrl()))
                .build();
    }

    @PostConstruct
    void validateConfiguration() {
        String baseUrl = properties.baseUrl();
        if (StringUtils.hasText(baseUrl) && baseUrl.startsWith("http://")) {
            String lower = baseUrl.toLowerCase();
            if (!lower.contains("localhost") && !lower.contains("127.0.0.1") && !lower.contains("[::1]")) {
                logger.warn("POCKETBASE_BASE_URL uses HTTP for a non-local address ({}). Use HTTPS for non-local deployments.", baseUrl);
            }
        }
    }

    public Optional<AiTokenRecord> findAiTokenByRawToken(String rawToken) {
        String tokenHash = sha256Hex(rawToken);
        String filter = String.format("token_hash=\"%s\"", tokenHash);

        RecordListResponse<AiTokenRecord> response = getCollectionRecords(
                "ai_tokens",
                filter,
                1,
                new ParameterizedTypeReference<>() {
                }
        );

        return response.items().stream().findFirst();
    }

    public Optional<UserRecord> authenticateUser(String identity, String password) {
        try {
            AuthResponse response = restClient.post()
                    .uri("/api/collections/users/auth-with-password")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of(
                            "identity", identity,
                            "password", password
                    ))
                    .retrieve()
                    .body(AuthResponse.class);

            if (response == null || response.record() == null || !StringUtils.hasText(response.record().id())) {
                return Optional.empty();
            }
            return Optional.of(response.record());
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().is4xxClientError()) {
                return Optional.empty();
            }
            throw ex;
        }
    }

    public OAuthClientRecord createOAuthClient(OAuthClientPayload payload) {
        OAuthClientRecord created = postCollectionRecord("oauth_clients", oauthClientBody(payload), OAuthClientRecord.class);
        return Objects.requireNonNull(created, "PocketBase oauth_clients create payload is required.");
    }

    public Optional<OAuthClientRecord> findOAuthClientByClientId(String clientId) {
        RecordListResponse<OAuthClientRecord> response = getCollectionRecords(
                "oauth_clients",
                String.format("client_id=\"%s\"", escapeFilterValue(clientId)),
                1,
                new ParameterizedTypeReference<>() {
                }
        );

        return response.items().stream().findFirst();
    }

    public Optional<OAuthClientRecord> findOAuthClientByClientNameAndRedirectUris(String clientName, List<String> redirectUris) {
        RecordListResponse<OAuthClientRecord> response = getCollectionRecords(
                "oauth_clients",
                String.format("client_name=\"%s\"", escapeFilterValue(clientName)),
                100,
                new ParameterizedTypeReference<>() {
                }
        );

        List<String> expectedRedirectUris = defaultList(redirectUris);
        return response.items().stream()
                .filter((record) -> defaultList(record.redirectUris()).equals(expectedRedirectUris))
                .findFirst();
    }

    public Optional<OAuthClientRecord> findOAuthClientByRecordId(String recordId) {
        try {
            return Optional.ofNullable(getRecordById("oauth_clients", recordId, OAuthClientRecord.class));
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().is4xxClientError()) {
                return Optional.empty();
            }
            throw ex;
        }
    }

    public OAuthClientRecord updateOAuthClient(String recordId, OAuthClientPayload payload) {
        OAuthClientRecord updated = patchCollectionRecord("oauth_clients", recordId, oauthClientBody(payload), OAuthClientRecord.class);
        return Objects.requireNonNull(updated, "PocketBase oauth_clients update payload is required.");
    }

    public void deleteOAuthClient(String recordId) {
        deleteCollectionRecord("oauth_clients", recordId);
    }

    public OAuthAuthorizationRecord createOAuthAuthorization(OAuthAuthorizationPayload payload) {
        OAuthAuthorizationRecord created = postCollectionRecord(
                "oauth_authorizations",
                oauthAuthorizationBody(payload),
                OAuthAuthorizationRecord.class
        );
        return Objects.requireNonNull(created, "PocketBase oauth_authorizations create payload is required.");
    }

    public Optional<OAuthAuthorizationRecord> findOAuthAuthorizationByAuthCode(String rawAuthCode) {
        return findOAuthAuthorizationByHash("auth_code_hash", sha256Hex(rawAuthCode));
    }

    public Optional<OAuthAuthorizationRecord> findOAuthAuthorizationByRefreshToken(String rawRefreshToken) {
        return findOAuthAuthorizationByHash("refresh_token_hash", sha256Hex(rawRefreshToken));
    }

    public Optional<OAuthAuthorizationRecord> findOAuthAuthorizationByAccessTokenJti(String accessTokenJti) {
        return findOAuthAuthorizationByField("access_token_jti", accessTokenJti, OAUTH_RECORD_TYPE_AUTHORIZATION);
    }

    public Optional<OAuthAuthorizationRecord> findOAuthAuthorizationByConsentState(String consentState) {
        return findOAuthAuthorizationByField("state.attributes.state", consentState, OAUTH_RECORD_TYPE_AUTHORIZATION);
    }

    public Optional<OAuthAuthorizationRecord> findOAuthAuthorizationByStateId(String authorizationId) {
        return findOAuthAuthorizationByField("state.id", authorizationId, OAUTH_RECORD_TYPE_AUTHORIZATION);
    }

    public Optional<OAuthAuthorizationRecord> findOAuthAuthorizationByClientAndUser(String clientId, String userId) {
        return findOAuthAuthorizationByClientAndUser(clientId, userId, OAUTH_RECORD_TYPE_AUTHORIZATION);
    }

    public Optional<OAuthAuthorizationRecord> findOAuthConsentByClientAndUser(String clientId, String userId) {
        return findOAuthAuthorizationByClientAndUser(clientId, userId, OAUTH_RECORD_TYPE_CONSENT);
    }

    private Optional<OAuthAuthorizationRecord> findOAuthAuthorizationByClientAndUser(String clientId, String userId, String recordType) {
        RecordListResponse<OAuthAuthorizationRecord> response = getCollectionRecords(
                "oauth_authorizations",
                String.format(
                        "client_id=\"%s\" && user=\"%s\" && record_type=\"%s\"",
                        escapeFilterValue(clientId),
                        escapeFilterValue(userId),
                        escapeFilterValue(recordType)
                ),
                1,
                new ParameterizedTypeReference<>() {
                }
        );

        return response.items().stream().findFirst();
    }

    public OAuthAuthorizationRecord updateOAuthAuthorization(String recordId, OAuthAuthorizationPayload payload) {
        OAuthAuthorizationRecord updated = patchCollectionRecord(
                "oauth_authorizations",
                recordId,
                oauthAuthorizationBody(payload),
                OAuthAuthorizationRecord.class
        );
        return Objects.requireNonNull(updated, "PocketBase oauth_authorizations update payload is required.");
    }

    public void deleteOAuthAuthorization(String recordId) {
        deleteCollectionRecord("oauth_authorizations", recordId);
    }

    public ProfileMaterialBundle loadProfileMaterial(String userId) {
        return new ProfileMaterialBundle(
                getOwnedRecords("skills", userId, "+sortOrder,+name"),
                getOwnedRecords("jobs", userId, "+sortOrder,-startDate"),
                getOwnedRecords("projects", userId, "+sortOrder,-date"),
                getOwnedRecords("achievements", userId, "+sortOrder,+title"),
                getOwnedRecords("degrees", userId, "+sortOrder,-year"),
                getOwnedRecords("hobbies", userId, "+sortOrder,+name")
        );
    }

    public List<TemplateDescriptor> resolveAvailableTemplates() {
        return TEMPLATE_DESCRIPTORS;
    }

    public void validateOwnedRecordIds(String collectionName, String userId, List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return;
        }

        List<String> uniqueIds = ids.stream()
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
        if (uniqueIds.size() != ids.size()) {
            throw new IllegalArgumentException("One or more selected records do not belong to the API key owner.");
        }

        for (String id : uniqueIds) {
            OwnedRecord record;
            try {
                record = getRecordById(collectionName, id);
            } catch (RuntimeException ex) {
                throw new IllegalArgumentException("One or more selected records do not belong to the API key owner.", ex);
            }
            if (record == null || !userId.equals(record.user())) {
                throw new IllegalArgumentException("One or more selected records do not belong to the API key owner.");
            }
        }
    }

    public List<CvProfileSummaryRecord> listCvProfilesForUser(String userId) {
        RecordListResponse<CvProfileSummaryRecord> response = getCollectionRecords(
                "cv_profiles",
                String.format("user=\"%s\"", escapeFilterValue(userId)),
                CV_PROFILE_LIST_PAGE_SIZE,
                new ParameterizedTypeReference<>() {
                },
                "-updated_at"
        );

        return response.items();
    }

    public CvProfileRecord findProfileBySlugOrId(String slugOrId) {
        RecordListResponse<CvProfileRecord> response = getCollectionRecords(
                "cv_profiles",
                String.format("(slug=\"%s\"||id=\"%s\")", escapeFilterValue(slugOrId), escapeFilterValue(slugOrId)),
                1,
                new ParameterizedTypeReference<>() {
                }
        );

        CvProfileRecord profile = response.items() != null ? response.items().stream().findFirst().orElse(null) : null;
        if (profile == null) {
            logger.warn("PocketBase cv_profiles lookup returned no match slugOrId={}", slugOrId);
        }
        return profile;
    }

    public UpdatedProfileRecord updateCvProfile(String profileId, Map<String, Object> patchBody) {
        UpdatedProfileRecord updated;
        try {
            updated = restClient.patch()
                    .uri("/api/collections/cv_profiles/records/{profileId}", profileId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .header(HttpHeaders.AUTHORIZATION, bearer(serviceUserToken()))
                    .body(patchBody)
                    .retrieve()
                    .body(UpdatedProfileRecord.class);
        } catch (RestClientResponseException ex) {
            logger.error(
                    "PocketBase cv_profiles update failed status={} profileId={} responseBody={}",
                    ex.getStatusCode().value(),
                    profileId,
                    ex.getResponseBodyAsString()
            );
            throw ex;
        }

        return Objects.requireNonNull(updated, "PocketBase updated profile payload is required.");
    }

    public CreatedProfileRecord createTailoredProfile(String userId, CreateProfilePayload payload) {
        String slug = payload.templateId() + "--" + slugify(payload.profileName()) + "-" + Instant.now().toEpochMilli();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("slug", slug);
        body.put("label", payload.label());
        body.put("profileName", payload.profileName());
        body.put("template", payload.templateId());
        body.put("public", true);
        body.put("user", userId);
        body.put("professionalSummary", payload.professionalSummary());
        body.put("skills", defaultList(payload.skillIds()));
        body.put("jobs", defaultList(payload.jobIds()));
        body.put("projects", defaultList(payload.projectIds()));
        body.put("achievements", defaultList(payload.achievementIds()));
        body.put("degrees", defaultList(payload.degreeIds()));
        body.put("hobbies", defaultList(payload.hobbyIds()));
        body.put("extra", payload.extra() == null ? Map.of() : payload.extra());

        CreatedProfileRecord created;
        try {
            created = restClient.post()
                    .uri("/api/collections/cv_profiles/records")
                    .contentType(MediaType.APPLICATION_JSON)
                    .header(HttpHeaders.AUTHORIZATION, bearer(serviceUserToken()))
                    .body(body)
                    .retrieve()
                    .body(CreatedProfileRecord.class);
        } catch (RestClientResponseException ex) {
            logger.error(
                    "PocketBase cv_profiles create failed status={} userId={} templateId={} profileName={} responseBody={}",
                    ex.getStatusCode().value(),
                    userId,
                    payload.templateId(),
                    payload.profileName(),
                    ex.getResponseBodyAsString()
            );
            throw ex;
        }

        return Objects.requireNonNull(created, "PocketBase created profile payload is required.");
    }

    public void markAiTokenUsed(String tokenId) {
        markAiTokenUsed(tokenId, Instant.now());
    }

    public void markAiTokenUsed(String tokenId, Instant lastUsedAt) {
        try {
            restClient.patch()
                    .uri("/api/collections/ai_tokens/records/{tokenId}", tokenId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .header(HttpHeaders.AUTHORIZATION, bearer(serviceUserToken()))
                    .body(Map.of("lastUsedAt", lastUsedAt.toString()))
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException ex) {
            logger.warn(
                    "PocketBase ai_tokens lastUsedAt update failed status={} tokenId={} responseBody={}",
                    ex.getStatusCode().value(),
                    tokenId,
                    ex.getResponseBodyAsString()
            );
        } catch (RuntimeException ex) {
            logger.warn("PocketBase ai_tokens lastUsedAt update failed tokenId={} message={}", tokenId, ex.getMessage());
        }
    }

    private List<Map<String, Object>> getOwnedRecords(String collectionName, String userId, String sort) {
        RecordListResponse<Map<String, Object>> response = getCollectionRecords(
                collectionName,
                String.format("user=\"%s\"", escapeFilterValue(userId)),
                200,
                new ParameterizedTypeReference<>() {
                },
                sort
        );
        return response.items();
    }

    private <T> RecordListResponse<T> getCollectionRecords(
            String collectionName,
            String filter,
            int perPage,
            ParameterizedTypeReference<RecordListResponse<T>> responseType
    ) {
        return getCollectionRecords(collectionName, filter, perPage, responseType, null);
    }

    private <T> RecordListResponse<T> getCollectionRecords(
            String collectionName,
            String filter,
            int perPage,
            ParameterizedTypeReference<RecordListResponse<T>> responseType,
            String sort
    ) {
        RecordListResponse<T> response = restClient.get()
                .uri((uriBuilder) -> {
                    uriBuilder = uriBuilder.path("/api/collections/{collectionName}/records")
                            .queryParam("filter", filter)
                            .queryParam("perPage", perPage);
                    if (StringUtils.hasText(sort)) {
                        uriBuilder = uriBuilder.queryParam("sort", sort);
                    }
                    return uriBuilder.build(collectionName);
                })
                .header(HttpHeaders.AUTHORIZATION, bearer(serviceUserToken()))
                .retrieve()
                .body(responseType);

        return Objects.requireNonNull(response, "PocketBase list response is required.");
    }

    private OwnedRecord getRecordById(String collectionName, String recordId) {
        return getRecordById(collectionName, recordId, OwnedRecord.class);
    }

    private <T> T getRecordById(String collectionName, String recordId, Class<T> responseType) {
        return restClient.get()
                .uri("/api/collections/{collectionName}/records/{recordId}", collectionName, recordId)
                .header(HttpHeaders.AUTHORIZATION, bearer(serviceUserToken()))
                .retrieve()
                .body(responseType);
    }

    private <T> T postCollectionRecord(String collectionName, Map<String, Object> body, Class<T> responseType) {
        return restClient.post()
                .uri("/api/collections/{collectionName}/records", collectionName)
                .contentType(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.AUTHORIZATION, bearer(serviceUserToken()))
                .body(body)
                .retrieve()
                .body(responseType);
    }

    private <T> T patchCollectionRecord(String collectionName, String recordId, Map<String, Object> body, Class<T> responseType) {
        return restClient.patch()
                .uri("/api/collections/{collectionName}/records/{recordId}", collectionName, recordId)
                .contentType(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.AUTHORIZATION, bearer(serviceUserToken()))
                .body(body)
                .retrieve()
                .body(responseType);
    }

    private void deleteCollectionRecord(String collectionName, String recordId) {
        restClient.delete()
                .uri("/api/collections/{collectionName}/records/{recordId}", collectionName, recordId)
                .header(HttpHeaders.AUTHORIZATION, bearer(serviceUserToken()))
                .retrieve()
                .toBodilessEntity();
    }

    private Optional<OAuthAuthorizationRecord> findOAuthAuthorizationByHash(String fieldName, String hash) {
        return findOAuthAuthorizationByField(fieldName, hash, OAUTH_RECORD_TYPE_AUTHORIZATION);
    }

    private Optional<OAuthAuthorizationRecord> findOAuthAuthorizationByField(String fieldName, String value, String recordType) {
        RecordListResponse<OAuthAuthorizationRecord> response = getCollectionRecords(
                "oauth_authorizations",
                String.format(
                        "%s=\"%s\" && record_type=\"%s\"",
                        fieldName,
                        escapeFilterValue(value),
                        escapeFilterValue(recordType)
                ),
                1,
                new ParameterizedTypeReference<>() {
                }
        );

        return response.items().stream().findFirst();
    }

    private Map<String, Object> oauthClientBody(OAuthClientPayload payload) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("client_id", payload.clientId());
        if (StringUtils.hasText(payload.rawClientSecret())) {
            body.put("client_secret_hash", sha256Hex(payload.rawClientSecret()));
        }
        body.put("client_name", payload.clientName());
        body.put("redirect_uris", defaultList(payload.redirectUris()));
        body.put("grant_types", defaultList(payload.grantTypes()));
        body.put("scopes", defaultList(payload.scopes()));
        body.put("token_settings", payload.tokenSettings() == null ? Map.of() : payload.tokenSettings());
        if (payload.expiresAt() != null) {
            body.put("expires_at", payload.expiresAt());
        }
        return body;
    }

    private Map<String, Object> oauthAuthorizationBody(OAuthAuthorizationPayload payload) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("record_type", StringUtils.hasText(payload.recordType()) ? payload.recordType() : OAUTH_RECORD_TYPE_AUTHORIZATION);
        body.put("user", payload.user());
        body.put("client_id", payload.clientId());
        body.put("scopes", defaultList(payload.scopes()));
        if (StringUtils.hasText(payload.rawAuthCode())) {
            body.put("auth_code_hash", sha256Hex(payload.rawAuthCode()));
        }
        if (StringUtils.hasText(payload.rawRefreshToken())) {
            body.put("refresh_token_hash", sha256Hex(payload.rawRefreshToken()));
        }
        if (StringUtils.hasText(payload.accessTokenJti())) {
            body.put("access_token_jti", payload.accessTokenJti());
        }
        if (payload.expiresAt() != null) {
            body.put("expires_at", payload.expiresAt());
        }
        body.put("status", StringUtils.hasText(payload.status()) ? payload.status() : "active");
        body.put("state", payload.state() == null ? Map.of() : payload.state());
        body.put("state_id", stateId(payload.state()));
        body.put("consent", payload.consent() == null ? Map.of() : payload.consent());
        return body;
    }

    private static String stateId(Map<String, Object> state) {
        Object stateId = state == null ? null : state.get("id");
        return stateId == null ? "" : stateId.toString();
    }

    private String serviceUserToken() {
        if (!StringUtils.hasText(properties.serviceUserEmail()) || !StringUtils.hasText(properties.serviceUserPassword())) {
            throw new IllegalStateException("PocketBase MCP service-user credentials are not configured.");
        }

        String token = cachedServiceUserToken;
        Instant expiresAt = cachedServiceUserTokenExpiresAt;
        if (StringUtils.hasText(token) && expiresAt != null && expiresAt.isAfter(Instant.now().plusSeconds(30))) {
            return token;
        }

        synchronized (this) {
            token = cachedServiceUserToken;
            expiresAt = cachedServiceUserTokenExpiresAt;
            if (StringUtils.hasText(token) && expiresAt != null && expiresAt.isAfter(Instant.now().plusSeconds(30))) {
                return token;
            }

            AuthResponse response = restClient.post()
                    .uri("/api/collections/users/auth-with-password")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of(
                            "identity", properties.serviceUserEmail(),
                            "password", properties.serviceUserPassword()
                    ))
                    .retrieve()
                    .body(AuthResponse.class);

            if (response == null || !StringUtils.hasText(response.token())) {
                throw new IllegalStateException("PocketBase MCP service-user authentication failed.");
            }

            cachedServiceUserToken = response.token();
            cachedServiceUserTokenExpiresAt = Instant.now().plusSeconds(300);
            return response.token();
        }
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }

    private static List<String> defaultList(List<String> values) {
        return values == null ? List.of() : values;
    }

    private static String slugify(String value) {
        StringBuilder slug = new StringBuilder();
        boolean lastWasDash = false;
        String normalizedValue = Objects.requireNonNullElse(value, "");

        for (char character : normalizedValue.toLowerCase().toCharArray()) {
            if (character >= 'a' && character <= 'z' || character >= '0' && character <= '9') {
                slug.append(character);
                lastWasDash = false;
                continue;
            }

            if (!lastWasDash) {
                slug.append('-');
                lastWasDash = true;
            }
        }

        String normalized = slug.toString().replaceAll("^-+|-+$", "");
        return normalized.isBlank() ? "profile" : normalized;
    }

    private static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] encoded = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder(encoded.length * 2);

            for (byte current : encoded) {
                builder.append(String.format("%02x", current));
            }

            return builder.toString();
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is not available.", ex);
        }
    }

    private static String escapeFilterValue(String value) {
        return Objects.requireNonNullElse(value, "").replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static String trimTrailingSlash(String value) {
        if (!StringUtils.hasText(value)) {
            return "";
        }

        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    public record TemplateDescriptor(String id, String label, String description, List<ExtraFieldDescriptor> extraSchema) {
    }

    public record ExtraFieldDescriptor(
            String id,
            String label,
            String type,
            boolean required,
            String description,
            String source,
            List<String> options
    ) {
    }

    public record ProfileMaterialBundle(
            List<Map<String, Object>> skills,
            List<Map<String, Object>> jobs,
            List<Map<String, Object>> projects,
            List<Map<String, Object>> achievements,
            List<Map<String, Object>> degrees,
            List<Map<String, Object>> hobbies
    ) {
    }

    public record CreateProfilePayload(
            String label,
            String profileName,
            String templateId,
            String professionalSummary,
            List<String> skillIds,
            List<String> jobIds,
            List<String> projectIds,
            List<String> achievementIds,
            List<String> degreeIds,
            List<String> hobbyIds,
            Map<String, Object> extra
    ) {
    }

    public record OAuthClientPayload(
            String clientId,
            String rawClientSecret,
            String clientName,
            List<String> redirectUris,
            List<String> grantTypes,
            List<String> scopes,
            Map<String, Object> tokenSettings,
            String expiresAt
    ) {
    }

    public record OAuthAuthorizationPayload(
            String recordType,
            String user,
            String clientId,
            List<String> scopes,
            String rawAuthCode,
            String rawRefreshToken,
            String accessTokenJti,
            String expiresAt,
            String status,
            Map<String, Object> state,
            Map<String, Object> consent
    ) {
        public OAuthAuthorizationPayload(
                String user,
                String clientId,
                List<String> scopes,
                String rawAuthCode,
                String rawRefreshToken,
                String accessTokenJti,
                String expiresAt,
                String status,
                Map<String, Object> state,
                Map<String, Object> consent
        ) {
            this(OAUTH_RECORD_TYPE_AUTHORIZATION, user, clientId, scopes, rawAuthCode, rawRefreshToken, accessTokenJti, expiresAt, status, state, consent);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record AuthResponse(String token, UserRecord record) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RecordListResponse<T>(List<T> items) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record AiTokenRecord(
            String id,
            String user,
            String label,
            String status,
            String expiresAt,
            @JsonProperty("token_hash") String tokenHash,
            @JsonProperty("token_prefix") String tokenPrefix
    ) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record OAuthClientRecord(
            String id,
            @JsonProperty("client_id") String clientId,
            @JsonProperty("client_secret_hash") String clientSecretHash,
            @JsonProperty("client_name") String clientName,
            @JsonProperty("redirect_uris") List<String> redirectUris,
            @JsonProperty("grant_types") List<String> grantTypes,
            List<String> scopes,
            @JsonProperty("token_settings") Map<String, Object> tokenSettings,
            @JsonProperty("expires_at") String expiresAt
    ) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record OAuthAuthorizationRecord(
            String id,
            @JsonProperty("record_type") String recordType,
            String user,
            @JsonProperty("client_id") String clientId,
            List<String> scopes,
            @JsonProperty("auth_code_hash") String authCodeHash,
            @JsonProperty("refresh_token_hash") String refreshTokenHash,
            @JsonProperty("access_token_jti") String accessTokenJti,
            @JsonProperty("expires_at") String expiresAt,
            String status,
            Map<String, Object> state,
            Map<String, Object> consent
    ) {
        public OAuthAuthorizationRecord(
                String id,
                String user,
                String clientId,
                List<String> scopes,
                String authCodeHash,
                String refreshTokenHash,
                String accessTokenJti,
                String expiresAt,
                String status,
                Map<String, Object> state,
                Map<String, Object> consent
        ) {
            this(id, OAUTH_RECORD_TYPE_AUTHORIZATION, user, clientId, scopes, authCodeHash, refreshTokenHash, accessTokenJti, expiresAt, status, state, consent);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CvProfileRecord(
            String id,
            String slug,
            String user,
            String template,
            Map<String, Object> extra
    ) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CvProfileSummaryRecord(
            String id,
            String slug,
            String label,
            String profileName,
            String template,
            @JsonProperty("public") Boolean publicProfile,
            @JsonProperty("updated_at") String updatedAt
    ) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CreatedProfileRecord(String id, String slug) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpdatedProfileRecord(String id, String slug) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record OwnedRecord(
            String id,
            String user
    ) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UserRecord(
            String id,
            String firstName,
            String lastName,
            String linkedin,
            String github,
            String website,
            String email,
            String phone
    ) {
    }
}
