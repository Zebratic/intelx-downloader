# IntelX Downloader

A Node.js CLI tool to preview and download files from intelx.io.

![Main Menu](images/menu.png)

## Setup

1. Clone the repository:
```bash
git clone https://github.com/Zebratic/intelx-downloader.git
cd intelx-downloader
```

2. Install dependencies:
```bash
npm install
```

3. Run the script to access the interactive menu and set your API key:
```bash
node index.js
```

The `.env` file will be automatically created. Select "Set API Key" from the menu to configure your IntelX API key.

### **Optional:** Add a shell alias for quick access:

First, in the `intelx-downloader` directory, run:
```bash
pwd
```
Copy the printed path. Then add this line to your shell config file, replacing `<copied_path>` with the output from `pwd`:
```bash
alias intelx="node <copied_path>/index.js"
```
Reload your shell (`source ~/.bashrc` or `source ~/.zshrc`). Now you can run `intelx` from any directory.


## Usage

### Basic Usage

Run the script without arguments to access the interactive menu:
```bash
node index.js
```

The menu provides the following options:
- **Search** - Search for files using a query or system ID
- **Set API Key** - Configure or update your IntelX API key (returns to menu after saving)
- **API Limits** - View your current API credit usage and limits (returns to menu after viewing)

After completing any action, you'll return to the main menu automatically, allowing you to perform multiple operations in a single session.

Or provide a query or system ID directly to skip the menu and go straight to search:
```bash
node index.js <query>
```

After completing the search and download operations, you'll return to the main menu.

![Search Interface](images/search.png)

### Options

- `-o, --output <path>` - Specify output zip file path (default: `./<query>.zip` in current directory)
- `-h, --help` - Display help information

### Examples

```bash
# Interactive mode
node index.js

# Search with query or system ID
node index.js example@email.com
node index.js 1d69f42e-3e31-46cc-a349-0870d07b3b61

# Custom output filename
node index.js example@email.com -o my-download.zip
```

## Features

- **Persistent interactive menu** - The main menu loops continuously, allowing you to perform multiple operations without restarting the program
- **Interactive menu** for searching, setting API key, and viewing API limits
- **Automatic `.env` file creation** and API key management
- **File preview mode** - Browse through search results with context highlighting, pagination, and quick download options
- **Multiple download modes**:
  - Preview files with search term context
  - Download files directly from search results
  - View and download from file tree structure
- **Automatic file tree parsing** and selection
- **Multiple record selection** when search returns multiple results
- **Downloads selected files** and creates a zip archive with preserved folder structure
- **API limits display** showing credit usage and reset times with visual progress bars
- **Navigation** - "Back to menu" option returns you to the main menu from any operation

## Screenshots

### File Preview Mode
Browse through search results with highlighted context around your search term. Navigate between files, download individual files, or return to the menu.

![File Preview](images/preview.png)

### API Limits Display
Monitor your API credit usage with a detailed table showing current usage, limits, percentages, reset times, and visual progress bars.

![API Limits](images/api-limits.png)

### File Selection
Select multiple files from search results or file trees using an interactive checkbox interface. Supports "Select All" and individual file selection.

![File Selection](images/files.png)
