# Smart Home Server Script Repo

This repository provides scripts for the smart home server system smorthome: [https://github.com/unterdrueckt/smarthome](https://github.com/unterdrueckt/smarthome).

## Folder Structure

Each folder represents a unique add-on script. Here's what you'll find inside:

- **package.json:** This mandatory file contains essential script information. It includes:
  - `name`: The name of your script.
  - `version`: **Specify the script's version (e.g., "1.0.0").**
  - `type`: Specify the component type (e.g., `script`, `driver`, `addon`).
  - `icon` (optional): **Choose one of the following options to specify an icon:**
    - **External Image URL:** Use `img:<url>` format, where `<url>` points to the image location (e.g., `img:https://picsum.photos/50`).
    - **Material Design Icons (MDI):** Use `mdi-<name>` format, where `<name>` is the specific MDI icon name (e.g., `mdi-alert-circle-outline`). Refer to the official MDI documentation for available icons: [https://m3.material.io/styles/icons](https://m3.material.io/styles/icons)
  - `description`: A concise description of the script's functionality.
  - `config` (optional): An optional JSON Object for configuration parameters, allowing customization without modifying core code.

## Example Structure

```
script-name/
├── package.json
└── index.{ts or js}
```

**Example package.json (with external image URL):**

```json
{
  "name": "example-script",
  "version": "1.0.0",
  "type": "script",
  "icon": "img:https://example.com/myicon.png",
  "description": "A script to control my smart lights."
}
```

**Example package.json (with MDI):**

```json
{
  "name": "lightbuld-driver",
  "version": "1.0.0",
  "type": "driver",
  "icon": "mdi-lightbulb",
  "description": "A script to control some generic lightbulb."
}
```

**Example package.json (with config):**

```json
{
  "name": "extension-addon",
  "version": "1.0.0",
  "type": "addon",
  "icon": "mdi-view-grid-plus",
  "description": "An add-on to extend the functions of the backend.",
  "config": {
    "username": "",
    "password": "",
    "guest": false
  }
}
```

**Note:**

- Ensure the external image URL is publicly accessible if using the first option.
- Make sure you're using a compatible icon library (like MDI) if using the second option. Refer to the library's documentation for available icon names.
