import { ComponentFixture, TestBed } from '@angular/core/testing';
import { resolveMcpEndpointUrl } from '../../core/utils/desktop-runtime-config';
import { McpConfigHelper } from './mcp-config-helper';

describe('McpConfigHelper', () => {
  let component: McpConfigHelper;
  let fixture: ComponentFixture<McpConfigHelper>;
  let clipboardWriteText: jest.Mock;

  beforeEach(async () => {
    clipboardWriteText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });

    await TestBed.configureTestingModule({
      imports: [McpConfigHelper],
    }).compileComponents();

    fixture = TestBed.createComponent(McpConfigHelper);
    fixture.componentRef.setInput('activeTokenCount', 2);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates and renders active token count', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('2 tokens actifs');
    expect(fixture.nativeElement.textContent).toContain('Configuration manuelle');
    expect(fixture.nativeElement.textContent).toContain('cle API');
  });

  it('uses a select for agent choice', () => {
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement | null;
    const agentButtons = fixture.nativeElement.querySelectorAll('.mcp-helper__agent');

    expect(select).toBeTruthy();
    expect(select?.options.length).toBe(5);
    expect(agentButtons.length).toBe(0);
  });

  it('updates selected agent from the select', () => {
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = 'opencode';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.selectedAgent()).toBe('opencode');
    expect(component.getGeneratedConfig()).toContain('"API_KEY"');
    expect(fixture.nativeElement.textContent).toContain('Configuration OpenCode');
  });

  it('generates plain essential values for the custom-client preset', () => {
    component.customToken.set('rmcp_custom');
    component.customUrl.set('http://localhost:8081/mcp');
    component.selectedAgent.set('custom-client');

    const config = component.getGeneratedConfig();

    expect(config).toContain('URL du serveur MCP : http://localhost:8081/mcp');
    expect(config).toContain('Transport          : HTTP (Streamable)');
    expect(config).toContain('Méthode auth       : Clé API');
    expect(config).toContain('Clé API            : rmcp_custom');
    expect(config).toContain('Resumate-Tool-Families: both');
  });

  it('generates config for the selected agent', () => {
    component.customToken.set('rmcp_test');
    component.customUrl.set('http://localhost:8080/mcp');
    component.selectedAgent.set('opencode');

    const config = component.getGeneratedConfig();

    expect(config).toContain('"resumate"');
    expect(config).toContain('"API_KEY": "rmcp_test"');
    expect(config).toContain('http://localhost:8080/mcp');
  });

  it('narrows the client configuration to the selected family', () => {
    component.selectedAgent.set('opencode');
    component.selectedFamilies.set('materials');
    expect(component.getGeneratedConfig()).toContain('"Resumate-Tool-Families": "materials"');
    component.selectedFamilies.set('cv');
    expect(component.getGeneratedConfig()).toContain('"Resumate-Tool-Families": "cv"');
  });

  it('generates Codex HTTP config for the Codex preset', () => {
    component.customToken.set('rmcp_codex');
    component.customUrl.set('http://localhost:8080/mcp');
    component.selectedAgent.set('codex');

    const config = component.getGeneratedConfig();

    expect(config).toContain('"transport": "http"');
    expect(config).toContain('"Authorization": "Bearer rmcp_codex"');
  });

  it('returns an empty config when the selected agent is unknown', () => {
    component.selectedAgent.set('missing-agent');

    expect(component.getSelectedPreset()).toBeUndefined();
    expect(component.getGeneratedConfig()).toBe('');
  });

  it('copies generated config to the clipboard', async () => {
    component.customToken.set('rmcp_copy');

    await component.copyConfig();

    expect(clipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('rmcp_copy'));
    expect(component.isCopied()).toBe(true);
  });

  it('reports not copied when copied agent differs from the selected agent', () => {
    component.copiedAgent.set('claude-code');
    component.selectedAgent.set('opencode');

    expect(component.isCopied()).toBe(false);
  });

  it('does not copy when no config can be generated', async () => {
    component.selectedAgent.set('missing-agent');

    await component.copyConfig();

    expect(clipboardWriteText).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when clipboard write fails', async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error('Clipboard blocked'));
    const execCommandSpy = jest.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommandSpy,
    });

    await component.copyConfig();

    expect(execCommandSpy).toHaveBeenCalledWith('copy');
    expect(component.isCopied()).toBe(true);
  });

  describe('custom-client mode', () => {
    beforeEach(() => {
      component.customToken.set('rmcp_custom_token');
      component.customUrl.set('https://example.com/mcp');
      component.selectedAgent.set('custom-client');
      fixture.detectChanges();
    });

    it('returns structured custom client config fields', () => {
      const fields = component.customClientConfig();

      expect(fields.length).toBe(7);
      expect(fields[0]).toEqual({ key: 'URL du serveur MCP', value: 'https://example.com/mcp', copyable: true });
      expect(fields[1]).toEqual({ key: 'Transport', value: 'HTTP (Streamable)', copyable: false });
      expect(fields[2]).toEqual({ key: "Méthode d'authentification", value: 'Clé API', copyable: false });
      expect(fields[3]).toEqual({ key: "Header d'autorisation", value: 'Authorization: Bearer rmcp_custom_token', copyable: true });
      expect(fields[4]).toEqual({ key: 'Clé API', value: 'rmcp_custom_token', copyable: true });
      expect(fields[5]).toEqual({ key: 'Header outils', value: 'Resumate-Tool-Families: both', copyable: true });
      expect(fields[6].key).toBe('Outils disponibles');
      expect(fields[6].copyable).toBe(false);
    });

    it('uses placeholder token when no custom token is set', () => {
      component.customToken.set('');
      const fields = component.customClientConfig();

      expect(fields[4].value).toBe('<votre-cle-api>');
      expect(fields[3].value).toBe('Authorization: Bearer <votre-cle-api>');
    });

    it('shows structured key-value list in the template', () => {
      const kvItems = fixture.nativeElement.querySelectorAll('.mcp-helper__kv-item');

      expect(kvItems.length).toBe(7);
      expect(kvItems[0].textContent).toContain('URL du serveur MCP');
      expect(kvItems[0].textContent).toContain('https://example.com/mcp');
    });

    it('shows Tout copier button instead of Copier la config', () => {
      const button = fixture.nativeElement.querySelector('.mcp-helper__output-header .secondary-button');

      expect(button.textContent.trim()).toBe('Tout copier');
    });

    it('shows pre block for non-custom-client presets', () => {
      component.selectedAgent.set('claude-code');
      fixture.detectChanges();

      const pre = fixture.nativeElement.querySelector('.mcp-helper__output pre');
      expect(pre).toBeTruthy();
      expect(pre.textContent).toContain('mcpServers');
    });

    it('copies a single field value', async () => {
      const field = component.customClientConfig()[0];
      await component.copyFieldValue(field.value, field.key);

      expect(clipboardWriteText).toHaveBeenCalledWith('https://example.com/mcp');
      expect(component.isFieldCopied('URL du serveur MCP')).toBe(true);
    });

    it('reports not copied for a different field key', () => {
      component.copiedField.set('URL du serveur MCP');

      expect(component.isFieldCopied('Clé API')).toBe(false);
    });

    it('copies all fields as a text block', async () => {
      await component.copyAllFields();

      expect(clipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('URL du serveur MCP : https://example.com/mcp'));
      expect(clipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('Transport : HTTP (Streamable)'));
      expect(clipboardWriteText).toHaveBeenCalledWith(expect.stringContaining("Méthode d'authentification : Clé API"));
      expect(component.isCopied()).toBe(true);
    });

    it('falls back to execCommand when copyFieldValue clipboard fails', async () => {
      clipboardWriteText.mockRejectedValueOnce(new Error('Clipboard blocked'));
      const execCommandSpy = jest.fn().mockReturnValue(true);
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: execCommandSpy,
      });

      await component.copyFieldValue('test-value', 'test-key');

      expect(execCommandSpy).toHaveBeenCalledWith('copy');
      expect(component.isFieldCopied('test-key')).toBe(true);
    });

    it('falls back to execCommand when copyAllFields clipboard fails', async () => {
      clipboardWriteText.mockRejectedValueOnce(new Error('Clipboard blocked'));
      const execCommandSpy = jest.fn().mockReturnValue(true);
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: execCommandSpy,
      });

      await component.copyAllFields();

      expect(execCommandSpy).toHaveBeenCalledWith('copy');
      expect(component.isCopied()).toBe(true);
    });

    it('has copy buttons only for copyable fields', () => {
      const copyButtons = fixture.nativeElement.querySelectorAll('.mcp-helper__kv-copy');

      // URL, authentication header, key, and optional tool-family header.
      expect(copyButtons.length).toBe(4);
    });
  });

  describe('URL source and reset', () => {
    afterEach(() => {
      delete window.__RESUMATE_DESKTOP_CONFIG__;
      delete window.__RESUMATE_RUNTIME_CONFIG__;
    });

    it('reports the URL as unmodified when it matches the resolved default', () => {
      expect(component.isUrlModified()).toBe(false);
    });

    it('reports the URL as modified after the user edits it', () => {
      component.customUrl.set('https://changed.example.com/mcp');

      expect(component.isUrlModified()).toBe(true);
    });

    it('resetUrl restores the resolved default and clears the modified state', () => {
      const original = component.customUrl();
      component.customUrl.set('https://changed.example.com/mcp');
      expect(component.isUrlModified()).toBe(true);

      component.resetUrl();

      expect(component.customUrl()).toBe(original);
      expect(component.isUrlModified()).toBe(false);
    });

    it('labels the URL source as desktop runtime config when a desktop MCP url is present', () => {
      window.__RESUMATE_DESKTOP_CONFIG__ = {
        appMode: 'desktop',
        pocketbaseUrl: 'http://localhost',
        mcpUrl: 'http://localhost:9000/mcp',
      };
      const fresh = TestBed.createComponent(McpConfigHelper).componentInstance;

      expect(fresh.urlSourceLabel()).toBe('Configuration desktop locale');
    });

    it('labels the URL source as hosted runtime config when a public base url is present', () => {
      window.__RESUMATE_RUNTIME_CONFIG__ = { mcpPublicBaseUrl: 'https://mcp.hosted.example.com' };
      const fresh = TestBed.createComponent(McpConfigHelper).componentInstance;

      expect(fresh.urlSourceLabel()).toBe('Configuration runtime hébergée');
    });

    it('labels the URL source as local fallback when no config sources are present', () => {
      const fresh = TestBed.createComponent(McpConfigHelper).componentInstance;

      expect(fresh.urlSourceLabel()).toBe('Fallback local PocketBase');
    });

    it('seeds the default URL from the resolved endpoint when no input is provided', () => {
      const fresh = TestBed.createComponent(McpConfigHelper).componentInstance;

      expect(fresh.customUrl()).toBe(resolveMcpEndpointUrl());
      expect(fresh['defaultMcpUrl']()).toBe(resolveMcpEndpointUrl());
      expect(fresh.isUrlModified()).toBe(false);
    });

    it('derives the default URL from the mcpEndpointUrl input', () => {
      fixture.componentRef.setInput('mcpEndpointUrl', 'https://input.example.com/mcp');
      fixture.detectChanges();

      expect(component['defaultMcpUrl']()).toBe('https://input.example.com/mcp');
    });

    it('reset uses the latest mcpEndpointUrl input value', () => {
      fixture.componentRef.setInput('mcpEndpointUrl', 'https://updated.example.com/mcp');
      component.onUrlEdited('https://edited.example.com/mcp');
      fixture.detectChanges();
      expect(component.isUrlModified()).toBe(true);

      component.resetUrl();

      expect(component.customUrl()).toBe('https://updated.example.com/mcp');
      expect(component.isUrlModified()).toBe(false);
    });

    it('uses the sourceLabel input when provided, overriding internal computation', () => {
      window.__RESUMATE_RUNTIME_CONFIG__ = { mcpPublicBaseUrl: 'https://mcp.hosted.example.com' };
      fixture.componentRef.setInput('sourceLabel', 'Source fournie par la page');
      fixture.detectChanges();

      expect(component.urlSourceLabel()).toBe('Source fournie par la page');
    });

    it('updates the source label when the sourceLabel input changes', () => {
      fixture.componentRef.setInput('sourceLabel', 'Configuration runtime hébergée');
      fixture.detectChanges();
      expect(component.urlSourceLabel()).toBe('Configuration runtime hébergée');

      fixture.componentRef.setInput('sourceLabel', 'Configuration desktop locale');
      fixture.detectChanges();
      expect(component.urlSourceLabel()).toBe('Configuration desktop locale');
    });

    it('falls back to internal computation when sourceLabel is undefined', () => {
      fixture.componentRef.setInput('sourceLabel', undefined);
      fixture.detectChanges();

      expect(component.urlSourceLabel()).toBe('Fallback local PocketBase');
    });

    it('renders the URL source label and a reset control after the URL input', () => {
      const sourceLabel = fixture.nativeElement.querySelector('.mcp-helper__url-source') as HTMLElement;
      const resetButton = fixture.nativeElement.querySelector('.mcp-helper__url-reset') as HTMLButtonElement;

      expect(sourceLabel).toBeTruthy();
      expect(sourceLabel.textContent).toContain(component.urlSourceLabel());
      expect(resetButton).toBeTruthy();
      expect(resetButton.disabled).toBe(true);

      const original = component.customUrl();
      component.customUrl.set('https://changed.example.com/mcp');
      fixture.detectChanges();
      expect(resetButton.disabled).toBe(false);

      resetButton.click();
      fixture.detectChanges();
      expect(component.customUrl()).toBe(original);
      expect(resetButton.disabled).toBe(true);
    });

    it('auto-syncs customUrl when mcpEndpointUrl input changes and user has not edited', () => {
      fixture.componentRef.setInput('mcpEndpointUrl', 'https://new-url.example.com/mcp');
      fixture.detectChanges();

      expect(component.customUrl()).toBe('https://new-url.example.com/mcp');
      expect(component.isUrlModified()).toBe(false);
    });

    it('does not overwrite customUrl when mcpEndpointUrl input changes and user has edited', () => {
      component.onUrlEdited('https://user-edited.example.com/mcp');
      fixture.detectChanges();

      fixture.componentRef.setInput('mcpEndpointUrl', 'https://new-url.example.com/mcp');
      fixture.detectChanges();

      expect(component.customUrl()).toBe('https://user-edited.example.com/mcp');
      expect(component.isUrlModified()).toBe(true);
    });

    it('resetUrl restores latest default URL and clears modified state after input changes', () => {
      // User edits first, input changes, then reset should use latest input
      component.onUrlEdited('https://user-edited.example.com/mcp');
      fixture.detectChanges();

      fixture.componentRef.setInput('mcpEndpointUrl', 'https://intermediate.example.com/mcp');
      fixture.detectChanges();

      // User edits again
      component.onUrlEdited('https://user-edited-2.example.com/mcp');
      fixture.detectChanges();

      // Input changes again
      fixture.componentRef.setInput('mcpEndpointUrl', 'https://final.example.com/mcp');
      fixture.detectChanges();

      component.resetUrl();
      fixture.detectChanges();

      expect(component.customUrl()).toBe('https://final.example.com/mcp');
      expect(component.isUrlModified()).toBe(false);

      // After reset, auto-sync should work again
      fixture.componentRef.setInput('mcpEndpointUrl', 'https://post-reset.example.com/mcp');
      fixture.detectChanges();

      expect(component.customUrl()).toBe('https://post-reset.example.com/mcp');
      expect(component.isUrlModified()).toBe(false);
    });
  });
});
