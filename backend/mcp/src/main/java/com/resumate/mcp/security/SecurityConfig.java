package com.resumate.mcp.security;

import org.springframework.context.annotation.Bean;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SecurityConfig {

    @Bean
    FilterRegistrationBean<McpToolAccess> toolAccessRegistration(McpToolAccess filter) {
        FilterRegistrationBean<McpToolAccess> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false); // Runs only inside the authenticated /mcp security chain.
        return registration;
    }

    @Bean
    @Order(1)
    SecurityFilterChain securityFilterChain(HttpSecurity http, AiTokenAuthenticationFilter aiTokenAuthenticationFilter, McpToolAccess toolAccess) throws Exception {
        return http
                .csrf(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .sessionManagement((sessions) -> sessions.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests((requests) -> requests.anyRequest().authenticated())
                .addFilterBefore(aiTokenAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(toolAccess, AiTokenAuthenticationFilter.class)
                .securityMatcher("/mcp", "/mcp/**")
                .build();
    }

    @Bean
    @Order(4)
    SecurityFilterChain localEndpointsSecurityFilterChain(HttpSecurity http) throws Exception {
        return http
                .csrf(AbstractHttpConfigurer::disable)
                .authorizeHttpRequests((requests) -> requests.anyRequest().permitAll())
                .build();
    }
}
