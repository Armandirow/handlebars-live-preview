import * as vscode from "vscode";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import handlebars from "handlebars";

export class HandlebarsPreviewProvider {
  public _panel?: vscode.WebviewPanel;
  private _workspaceRoot: string;
  private _watchers: vscode.FileSystemWatcher[] = [];
  private _templateDataCache: Map<string, any> = new Map();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    workspaceRoot: string
  ) {
    this._workspaceRoot = workspaceRoot;
    this.registerHelpers();
  }

  public createOrShow() {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      "handlebars-preview",
      "Handlebars Template Preview",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [this._extensionUri],
      }
    );

    // Register partials before setting up the webview
    this.registerPartials();

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "getTemplates":
            const templates = this.getAvailableTemplates();
            this._panel!.webview.postMessage({
              command: "templates",
              templates,
            });
            break;
          case "renderTemplate":
            try {
              const html = this.renderTemplate(
                message.templateName,
                message.data || {}
              );
              // Save data for this template
              this.saveTemplateData(message.templateName, message.data || {});
              this._panel!.webview.postMessage({
                command: "rendered",
                html,
              });
            } catch (error) {
              this._panel!.webview.postMessage({
                command: "error",
                error: error instanceof Error ? error.message : "Unknown error",
              });
            }
            break;
          case "getTemplateData":
            const data = this.getTemplateData(message.templateName);
            this._panel!.webview.postMessage({
              command: "templateData",
              data,
            });
            break;
          case "clearTemplateData":
            this.clearTemplateData(message.templateName);
            this._panel!.webview.postMessage({
              command: "templateDataCleared",
            });
            break;
        }
      },
      undefined,
      []
    );

    // Set up file watchers for live reload
    this.setupFileWatchers();

    // Clean up when panel is closed
    this._panel.onDidDispose(() => {
      this._panel = undefined;
      this._watchers.forEach((watcher) => watcher.dispose());
      this._watchers = [];
    });
  }

  private getConfiguration() {
    const config = vscode.workspace.getConfiguration("handlebarsPreview");
    return {
      templateDirectories: config.get<string[]>("templateDirectories") || [
        "templates",
        "src/templates",
        "views",
      ],
      partialsDirectories: config.get<string[]>("partialsDirectories") || [],
      customHelpersFile: config.get<string>("customHelpersFile") || "",
    };
  }

  private getTemplateDirectories(): string[] {
    const config = this.getConfiguration();
    return config.templateDirectories
      .map((dir) =>
        dir.startsWith("/") ? dir : join(this._workspaceRoot, dir)
      )
      .filter((dir) => existsSync(dir));
  }

  private getPartialsDirectories(): string[] {
    const config = this.getConfiguration();
    const partialsDirs =
      config.partialsDirectories.length > 0
        ? config.partialsDirectories
        : config.templateDirectories;
    return partialsDirs
      .map((dir) =>
        dir.startsWith("/") ? dir : join(this._workspaceRoot, dir)
      )
      .filter((dir) => existsSync(dir));
  }

  private registerPartials() {
    console.log("🔄 Starting partial registration...");
    const partialsDirs = this.getPartialsDirectories();
    console.log("📁 Partials directories:", partialsDirs);
    partialsDirs.forEach((dir) => {
      this.registerPartialsRecursively(dir);
    });
    if (this._panel) {
      this._panel.webview.postMessage({
        command: "partialsRegistered",
      });
    }
    console.log("✅ Partial registration completed");
  }

  private registerHelpers() {
    // Load custom helpers
    this.loadCustomHelpers().catch((error) => {
      console.error(
        "[handlebars-preview] Error loading custom helpers:",
        error
      );
    });
  }

  private async loadCustomHelpers() {
    const config = this.getConfiguration();
    if (!config.customHelpersFile) {
      console.log("[handlebars-preview] No custom helpers file configured");
      return;
    }

    try {
      const helpersPath = config.customHelpersFile.startsWith("/")
        ? config.customHelpersFile
        : join(this._workspaceRoot, config.customHelpersFile);

      if (!existsSync(helpersPath)) {
        console.warn(
          `[handlebars-preview] Custom helpers file not found: ${helpersPath}`
        );
        return;
      }

      // Clear require cache to allow reloading
      delete require.cache[require.resolve(helpersPath)];

      // dynamic import (ESM compatible)
      const module = await import(helpersPath);

      const helpers = module.default || module; // support default OR named exports

      const registeredHelpers: string[] = [];
      if (typeof helpers === "object" && helpers !== null) {
        Object.entries(helpers).forEach(([name, helper]) => {
          if (typeof helper === "function") {
            handlebars.registerHelper(
              name,
              function (this: any, ...args: any[]) {
                const options = args.at(-1);

                // Inject hbs into options for runtime access
                if (!options.data) options.data = {};
                options.data.hbs = handlebars;

                return helper.apply(this, args);
              }
            );

            registeredHelpers.push(name);

            console.log(
              `[handlebars-preview] Registered custom helper: ${name}`
            );
          }
        });

        // Notify user about custom helpers
        if (registeredHelpers.length > 0) {
          vscode.window.showInformationMessage(
            `Handlebars Live Preview: Registered ${
              registeredHelpers.length
            } custom helpers: ${registeredHelpers.join(", ")}`
          );
        } else {
          vscode.window.showWarningMessage(
            "Handlebars Live Preview: No valid helper functions found in custom helpers file"
          );
        }
      } else {
        vscode.window.showErrorMessage(
          "Handlebars Live Preview: Custom helpers file should export an object with helper functions"
        );
        console.warn(
          `[handlebars-preview] Custom helpers file should export an object with helper functions: ${helpersPath}`
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(
        `Handlebars Live Preview: Failed to load custom helpers: ${errorMessage}`
      );
      console.error(
        `[handlebars-preview] Error loading custom helpers:`,
        error
      );
    }
  }

  public async reloadHelpers() {
    vscode.window.showInformationMessage(
      "Handlebars Live Preview: Reloading helpers..."
    );
    this.registerHelpers();
    this.autoRerender();
  }

  private getTemplateDataKey(templateName: string): string {
    return `${this._workspaceRoot}:${templateName}`;
  }

  private saveTemplateData(templateName: string, data: any) {
    const key = this.getTemplateDataKey(templateName);
    this._templateDataCache.set(key, data);
  }

  private getTemplateData(templateName: string): any {
    const key = this.getTemplateDataKey(templateName);
    return this._templateDataCache.get(key) || {};
  }

  private clearTemplateData(templateName: string) {
    const key = this.getTemplateDataKey(templateName);
    this._templateDataCache.delete(key);
  }

  private registerPartialsRecursively(dir: string) {
    try {
      const files = readdirSync(dir);

      files.forEach((file: string) => {
        const filePath = join(dir, file);
        const stat = statSync(filePath);

        if (stat.isDirectory()) {
          this.registerPartialsRecursively(filePath);
        } else if (file.endsWith(".hbs")) {
          // Get the relative path from the base directory
          const relativePath = filePath.replace(this._workspaceRoot + "/", "");
          const partialName = relativePath.replace(".hbs", "");
          const content = readFileSync(filePath, "utf8");

          // Register with the full path name
          handlebars.registerPartial(partialName, content);
          console.log(`📄 Registered partial: ${partialName}`);

          // Also register with just the filename (without path) for convenience
          const fileName = file.replace(".hbs", "");
          if (fileName !== partialName) {
            handlebars.registerPartial(fileName, content);
            console.log(`📄 Registered partial (filename): ${fileName}`);
          }
        }
      });
    } catch (error) {
      console.error("Error registering partials:", error);
    }
  }

  private setupFileWatchers() {
    const templateDirs = this.getTemplateDirectories();
    const partialsDirs = this.getPartialsDirectories();

    // Watch template directories
    templateDirs.forEach((dir) => {
      const relativeDir = dir.replace(this._workspaceRoot + "/", "");
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          this._workspaceRoot,
          `${relativeDir}/**/*.hbs`
        )
      );

      watcher.onDidChange(() => {
        this.registerPartials();
        this.refreshTemplates();
        this.autoRerender();
      });

      watcher.onDidCreate(() => {
        this.registerPartials();
        this.refreshTemplates();
      });

      watcher.onDidDelete(() => {
        this.registerPartials();
        this.refreshTemplates();
      });

      this._watchers.push(watcher);
    });

    // Watch partials directories (if different from template directories)
    partialsDirs.forEach((dir) => {
      if (!templateDirs.includes(dir)) {
        const relativeDir = dir.replace(this._workspaceRoot + "/", "");
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(
            this._workspaceRoot,
            `${relativeDir}/**/*.hbs`
          )
        );

        watcher.onDidChange(() => {
          this.registerPartials();
        });

        watcher.onDidCreate(() => {
          this.registerPartials();
        });

        watcher.onDidDelete(() => {
          this.registerPartials();
        });

        this._watchers.push(watcher);
      }
    });
  }

  private autoRerender() {
    if (this._panel) {
      console.log("Sending autoRerender command to webview");
      // Send a message to the webview to auto-render the current template
      this._panel.webview.postMessage({
        command: "autoRerender",
      });
    }
  }

  public refreshTemplates() {
    if (this._panel) {
      const templates = this.getAvailableTemplates();
      this._panel.webview.postMessage({
        command: "templates",
        templates,
      });
    }
  }

  private getAvailableTemplates(): Array<{
    name: string;
    directory: string;
    fullPath: string;
  }> {
    const templates: Array<{
      name: string;
      directory: string;
      fullPath: string;
    }> = [];
    const templateDirs = this.getTemplateDirectories();

    templateDirs.forEach((dir) => {
      this.getTemplatesRecursively(dir, templates, dir);
    });

    return templates.filter((t) => !t.name.includes("components/"));
  }

  private getTemplatesRecursively(
    dir: string,
    templates: Array<{ name: string; directory: string; fullPath: string }>,
    baseDir: string
  ) {
    try {
      const files = readdirSync(dir);

      files.forEach((file: string) => {
        const filePath = join(dir, file);
        const stat = statSync(filePath);

        if (stat.isDirectory()) {
          this.getTemplatesRecursively(filePath, templates, baseDir);
        } else if (file.endsWith(".hbs")) {
          const relativePath = filePath.replace(baseDir + "/", "");
          const templateName = relativePath.replace(".hbs", "");
          const directoryName = baseDir.replace(this._workspaceRoot + "/", "");
          templates.push({
            name: templateName,
            directory: directoryName,
            fullPath: filePath,
          });
        }
      });
    } catch (error) {
      console.error("Error reading templates directory:", error);
    }
  }

  private renderTemplate(templateName: string, data: any): string {
    const templates = this.getAvailableTemplates();
    const template = templates.find((t) => t.name === templateName);

    if (!template) {
      throw new Error(`Template not found: ${templateName}`);
    }

    // Ensure partials are registered before compilation
    this.registerPartials();

    // Debug: Check if partials are actually registered
    console.log("🔍 Checking registered partials before compilation:");
    const registeredPartials = Object.keys(handlebars.partials || {});
    console.log("📋 Registered partials:", registeredPartials);

    // Check specifically for plan-name
    if (handlebars.partials && handlebars.partials["plan-name"]) {
      console.log("✅ plan-name partial is registered");
    } else {
      console.log("❌ plan-name partial is NOT registered");
    }

    const templateContent = readFileSync(template.fullPath, "utf8");
    const compiledTemplate = handlebars.compile(templateContent);
    return compiledTemplate(data);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const htmlPath = join(this._extensionUri.fsPath, "src", "webview.html");
    return readFileSync(htmlPath, "utf8");
  }

  public dispose() {
    this._watchers.forEach((watcher) => watcher.dispose());
  }
}

export function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage("No workspace folder found");
    return;
  }

  // Create the provider
  const provider = new HandlebarsPreviewProvider(
    context.extensionUri,
    workspaceRoot
  );

  // Check if configuration is set up
  const config = vscode.workspace.getConfiguration("handlebarsPreview");
  const templateDirs = config.get<string[]>("templateDirectories") || [];
  const hasConfiguredDirs = templateDirs.some((dir) => {
    const fullPath = dir.startsWith("/") ? dir : join(workspaceRoot, dir);
    return existsSync(fullPath);
  });

  if (!hasConfiguredDirs) {
    vscode.window
      .showInformationMessage(
        "Handlebars Live Preview: No template directories found. Please configure 'handlebarsPreview.templateDirectories' in settings.",
        "Open Settings"
      )
      .then((selection) => {
        if (selection === "Open Settings") {
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "handlebarsPreview.templateDirectories"
          );
        }
      });
  }

  // Register commands
  const openPreviewCommand = vscode.commands.registerCommand(
    "handlebars-preview.openPreview",
    () => {
      provider.createOrShow();
    }
  );

  const refreshPreviewCommand = vscode.commands.registerCommand(
    "handlebars-preview.refreshPreview",
    () => {
      provider.refreshTemplates();
    }
  );

  const reloadHelpersCommand = vscode.commands.registerCommand(
    "handlebars-preview.reloadHelpers",
    () => {
      provider.reloadHelpers();
    }
  );

  const clearDataCommand = vscode.commands.registerCommand(
    "handlebars-preview.clearData",
    () => {
      if (provider._panel) {
        provider._panel.webview.postMessage({ command: "clearAllData" });
      }
    }
  );

  context.subscriptions.push(
    openPreviewCommand,
    refreshPreviewCommand,
    reloadHelpersCommand,
    clearDataCommand
  );
}

export function deactivate() {}
