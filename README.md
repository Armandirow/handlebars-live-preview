# Handlebars Live Preview VS Code Extension

A VS Code extension that provides live preview functionality for Handlebars templates with configurable directories and custom helpers.

## Features

- **Live Preview**: Real-time preview of Handlebars templates as you edit them
- **Configurable Directories**: Set multiple template and partial directories via VS Code settings
- **Custom Helpers**: Load custom Handlebars helpers from JavaScript/TypeScript files
- **Data Persistence**: Per-template data persistence - your JSON data is saved and restored
- **Live Reload**: Automatically refreshes when templates change
- **VS Code Integration**: Native VS Code UI with proper theming
- **Context Menu**: Right-click on `.hbs` files to open preview
- **Mobile Preview**: Toggle between desktop and mobile view

## Usage

### Configuration

First, configure the extension settings:

1. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
2. Search for "handlebars preview"
3. Configure the following settings:
   - `handlebarsPreview.templateDirectories`: Array of directories to search for templates (default: `["templates", "src/templates", "views"]`)
   - `handlebarsPreview.partialsDirectories`: Array of directories for partials (optional, defaults to template directories)
   - `handlebarsPreview.translationsDirectory`: Directory for translation files (optional, enables `intl` helper)
   - `handlebarsPreview.customHelpersFile`: Path to JavaScript/TypeScript file with custom helpers (optional)

### Opening the Preview

1. **Command Palette**: Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and type "Handlebars: Open Handlebars Preview"
2. **Context Menu**: Right-click on any `.hbs` file in the Explorer and select "Open Handlebars Preview"
3. **Sidebar**: The preview panel will appear in the sidebar

### Using the Preview

1. Select a template from the dropdown (shows directory info)
2. Edit the JSON data in the textarea (data is automatically saved per template)
3. Click "Render" to see the preview
4. Use "Clear Data" to reset the current template's data
5. The preview updates automatically when you save template files

## Development

### Prerequisites

- Node.js
- VS Code
- TypeScript

### Building

```bash
npm install
npm run compile
```

### Running in Development

1. Open this folder in VS Code
2. Press `F5` to run the extension in a new Extension Development Host window
3. The extension will be loaded and you can test it

### Watching for Changes

```bash
npm run watch
```

This will compile TypeScript files as you make changes.

## Custom Helpers

Create a JavaScript or TypeScript file that exports an object with helper functions:

### JavaScript Example

```javascript
// helpers.js
module.exports = {
  formatDate: (date) => new Date(date).toLocaleDateString(),
  uppercase: (str) => str.toUpperCase(),
  // Add more helpers as needed
};
```

### TypeScript Example

```typescript
// helpers.ts
// Option 1: CommonJS export
export = {
  formatDate: (date: string | Date): string =>
    new Date(date).toLocaleDateString(),
  uppercase: (str: string): string => str.toUpperCase(),
  truncate: (str: string, length: number): string =>
    str.length > length ? str.substring(0, length) + "..." : str,
  // Add more helpers as needed
};

// Option 2: ES6 default export (also supported)
export default {
  formatDate: (date: string | Date): string =>
    new Date(date).toLocaleDateString(),
  uppercase: (str: string): string => str.toUpperCase(),
  truncate: (str: string, length: number): string =>
    str.length > length ? str.substring(0, length) + "..." : str,
  // Add more helpers as needed
};
```

Then set `handlebarsPreview.customHelpersFile` to the path of this file.

**Note:** For TypeScript files, the extension will automatically compile them using ts-node or fallback to tsc compilation.

## Built-in Helpers

The extension includes these built-in Handlebars helpers:

- `ifEven`: Check if a number is even
- `eq`: Compare two values for equality
- `includes`: Check if an array includes a value
- `or`: Logical OR operation
- `currentYear`: Get current year
- `intl`: Internationalization helper (if translations directory is configured)

## Commands

- `Handlebars: Open Handlebars Preview` - Opens the preview panel
- `Handlebars: Refresh Preview` - Refreshes the template list
- `Handlebars: Reload Custom Helpers` - Reloads custom helpers from file
- `Handlebars: Clear Template Data` - Clears all saved template data

## Requirements

- VS Code 1.74.0 or higher
- Node.js workspace with Handlebars templates

## License

MIT
