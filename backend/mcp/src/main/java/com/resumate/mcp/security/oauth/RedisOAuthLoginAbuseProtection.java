package com.resumate.mcp.security.oauth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.RedisOperations;
import org.springframework.data.redis.core.SessionCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Redis-backed {@link OAuthLoginAbuseProtectionService} that stores failed-attempt
 * counters in a shared Redis instance so rate limiting is consistent across multiple
 * application nodes.
 *
 * <p>Counters are maintained with the standard {@code INCR} + {@code EXPIRE} pattern:
 * the first attempt in a window sets the key TTL to {@link OAuthLoginAbuseProtection#WINDOW},
 * and the pair is considered blocked once the counter reaches
 * {@link OAuthLoginAbuseProtection#MAX_FAILED_ATTEMPTS}.
 *
 * <p>If Redis is unavailable for any operation, the call transparently falls back to a
 * private in-memory {@link OAuthLoginAbuseProtection} instance so authentication keeps
 * working (fail-open on the backend, fail-closed on abuse).
 *
 * <p>Active only when {@code resumate.oauth.rate-limiter.type=redis}.
 */
@Component
@ConditionalOnProperty(name = "resumate.oauth.rate-limiter.type", havingValue = "redis")
public class RedisOAuthLoginAbuseProtection implements OAuthLoginAbuseProtectionService {

    static final String KEY_PREFIX = "oauth:ratelimit:";

    private static final Logger LOGGER = LoggerFactory.getLogger(RedisOAuthLoginAbuseProtection.class);

    private final StringRedisTemplate redisTemplate;
    private final OAuthLoginAbuseProtection fallback;

    public RedisOAuthLoginAbuseProtection(StringRedisTemplate redisTemplate) {
        this(redisTemplate, new OAuthLoginAbuseProtection());
    }

    RedisOAuthLoginAbuseProtection(StringRedisTemplate redisTemplate, OAuthLoginAbuseProtection fallback) {
        this.redisTemplate = redisTemplate;
        this.fallback = fallback;
    }

    @Override
    public boolean isBlocked(String type, String key) {
        try {
            String redisKey = redisKey(type, key);
            long now = Instant.now().toEpochMilli();
            prune(redisKey, now);
            Long attempts = redisTemplate.opsForZSet().count(redisKey, 0, now);
            if (attempts == null || attempts < OAuthLoginAbuseProtection.MAX_FAILED_ATTEMPTS) {
                return false;
            }
            Set<ZSetOperations.TypedTuple<String>> latest = redisTemplate.opsForZSet().reverseRangeWithScores(redisKey, 0, 0);
            if (latest == null || latest.isEmpty()) {
                return false;
            }
            Double latestAttempt = latest.iterator().next().getScore();
            return latestAttempt != null && latestAttempt.longValue() + OAuthLoginAbuseProtection.LOCKOUT.toMillis() > now;
        } catch (RuntimeException ex) {
            LOGGER.warn("Redis unavailable for isBlocked, falling back to in-memory abuse protection", ex);
            return fallback.isBlocked(type, key);
        }
    }

    @Override
    public void recordAttempt(String type, String key) {
        try {
            String redisKey = redisKey(type, key);
            long now = Instant.now().toEpochMilli();
            String member = now + ":" + UUID.randomUUID();
            redisTemplate.execute(new SessionCallback<>() {
                @Override
                public Object execute(RedisOperations operations) {
                    operations.multi();
                    operations.opsForZSet().removeRangeByScore(redisKey, 0, now - OAuthLoginAbuseProtection.WINDOW.toMillis());
                    operations.opsForZSet().add(redisKey, member, (double) now);
                    operations.expire(redisKey, OAuthLoginAbuseProtection.WINDOW);
                    return operations.exec();
                }
            });
        } catch (RuntimeException ex) {
            LOGGER.warn("Redis unavailable for recordAttempt, falling back to in-memory abuse protection", ex);
            fallback.recordAttempt(type, key);
        }
    }

    @Override
    public void reset(String type, String key) {
        try {
            redisTemplate.delete(redisKey(type, key));
        } catch (RuntimeException ex) {
            LOGGER.warn("Redis unavailable for reset, falling back to in-memory abuse protection", ex);
            fallback.reset(type, key);
        }
    }

    private static String redisKey(String type, String key) {
        // Match the in-memory limiter: case/whitespace variants of an identity must
        // share one bucket, otherwise "Alice@x" and "alice@x" each get a fresh quota.
        String normalizedKey = key == null || key.isBlank() ? "unknown" : key.trim().toLowerCase(Locale.ROOT);
        return KEY_PREFIX + type + ":" + normalizedKey;
    }

    private void prune(String redisKey, long now) {
        redisTemplate.opsForZSet().removeRangeByScore(redisKey, 0, now - OAuthLoginAbuseProtection.WINDOW.toMillis());
    }
}
