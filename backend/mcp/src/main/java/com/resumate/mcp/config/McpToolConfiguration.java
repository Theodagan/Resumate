package com.resumate.mcp.config;

import com.resumate.mcp.tool.CvMcpTools;
import com.resumate.mcp.tool.MaterialMcpTools;
import org.springframework.ai.tool.ToolCallbackProvider;
import org.springframework.ai.tool.method.MethodToolCallbackProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

@Configuration
public class McpToolConfiguration {

    @Bean
    RestClient.Builder restClientBuilder() {
        return RestClient.builder();
    }

    @Bean
    ToolCallbackProvider resumateToolCallbacks(CvMcpTools cvMcpTools, MaterialMcpTools materialMcpTools) {
        return MethodToolCallbackProvider.builder()
                .toolObjects(cvMcpTools, materialMcpTools)
                .build();
    }
}
