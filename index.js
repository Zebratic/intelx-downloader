#!/usr/bin/env node

import dotenv from 'dotenv';
import { program } from 'commander';
import inquirer from 'inquirer';
import archiver from 'archiver';
import { createWriteStream, existsSync, writeFileSync, readFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

const ENV_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), '.env');
const BASE_URL = 'https://2.intelx.io';

// Ensure .env file exists
function ensureEnvFile() {
  if (!existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, 'INTELX_API_KEY=\n', 'utf8');
  }
}

// Set API key in .env file
function setApiKey(apiKey) {
  ensureEnvFile();
  writeFileSync(ENV_PATH, `INTELX_API_KEY=${apiKey}\n`, 'utf8');
}

// Get API key from .env file
function getApiKey() {
  ensureEnvFile();
  dotenv.config({ path: ENV_PATH });
  return process.env.INTELX_API_KEY;
}

ensureEnvFile();
let API_KEY = getApiKey();

function getHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.5',
    'x-key': API_KEY,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache'
  };
}

async function searchBySystemId(systemId) {
  const url = `${BASE_URL}/intelligent/search`;
  const body = JSON.stringify({
    term: systemId,
    lookuplevel: 0,
    maxresults: 1000,
    timeout: null,
    datefrom: '',
    dateto: '',
    sort: 2,
    media: 0,
    terminate: []
  });

  const response = await fetch(url, {
    credentials: 'omit',
    headers: {
      ...getHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Priority': 'u=0'
    },
    body: body,
    method: 'POST',
    mode: 'cors'
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.id;
}

async function getSearchResults(searchId, limit = 1000) {
  const url = `${BASE_URL}/intelligent/search/result?id=${searchId}&limit=${limit}&statistics=1&previewlines=8`;
  
  const response = await fetch(url, {
    credentials: 'omit',
    headers: getHeaders(),
    method: 'GET',
    mode: 'cors'
  });

  if (!response.ok) {
    throw new Error(`Get results failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

async function getFileTree(storageId, bucket) {
  const url = `${BASE_URL}/file/view?f=12&storageid=${storageId}&bucket=${bucket}&k=${API_KEY}&license=researcher`;
  
  const response = await fetch(url, {
    credentials: 'omit',
    headers: {
      ...getHeaders(),
      'Priority': 'u=0'
    },
    method: 'GET',
    mode: 'cors'
  });

  if (!response.ok) {
    throw new Error(`Get file tree failed: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

async function getFilePreview(storageId, bucket) {
  const url = `${BASE_URL}/file/view?f=0&storageid=${storageId}&bucket=${bucket}&k=${API_KEY}&license=researcher`;
  
  const response = await fetch(url, {
    credentials: 'omit',
    headers: {
      ...getHeaders(),
      'Priority': 'u=0'
    },
    method: 'GET',
    mode: 'cors'
  });

  if (!response.ok) {
    throw new Error(`Get file preview failed: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

async function getApiLimits() {
  const url = `${BASE_URL}/authenticate/info`;
  
  const response = await fetch(url, {
    credentials: 'omit',
    headers: getHeaders(),
    method: 'GET',
    mode: 'cors'
  });

  if (!response.ok) {
    throw new Error(`Get API limits failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

function findContextInFile(content, searchTerm, contextLines = 5) {
  const lines = content.split('\n');
  const matches = [];
  const searchLower = searchTerm.toLowerCase();
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(searchLower)) {
      const start = Math.max(0, i - contextLines);
      const end = Math.min(lines.length, i + contextLines + 1);
      const context = lines.slice(start, end);
      matches.push({
        lineNumber: i + 1,
        context: context,
        matchLine: i - start
      });
    }
  }
  
  return matches;
}

function stripAnsiCodes(str) {
  // Remove ANSI color codes to get actual text length
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

function wrapLine(text, maxWidth) {
  // Split by whitespace sequences (3+ spaces treated as column separator)
  const parts = text.split(/(\s{3,}|\s+)/);
  const lines = [];
  let currentLine = '';
  
  for (const part of parts) {
    const partLength = stripAnsiCodes(part).length;
    const currentLength = stripAnsiCodes(currentLine).length;
    
    // If adding this part would exceed width
    if (currentLength + partLength > maxWidth && currentLine.length > 0) {
      // If it's a long whitespace sequence (3+ spaces), break before it
      if (part.match(/^\s{3,}$/)) {
        lines.push(currentLine.trimEnd());
        currentLine = '';
        // Don't add the whitespace, start fresh
        continue;
      } else {
        // Regular word, push current line and start new one
        lines.push(currentLine.trimEnd());
        currentLine = part;
        continue;
      }
    }
    
    currentLine += part;
  }
  
  if (currentLine.trim().length > 0) {
    lines.push(currentLine.trimEnd());
  }
  
  return lines;
}

function formatPreview(matches, searchTerm, maxMatches = 3) {
  if (matches.length === 0) {
    return chalk.yellow('No matches found in file content.');
  }
  
  const terminalWidth = process.stdout.columns || 80;
  const lineNumWidth = 8; // ">123456: " or " 123456: "
  const maxLineWidth = terminalWidth - lineNumWidth - 2; // Leave some margin
  
  let output = '';
  const displayMatches = matches.slice(0, maxMatches);
  
  for (const match of displayMatches) {
    output += chalk.cyan(`\n--- Match at line ${match.lineNumber} ---\n`);
    for (let i = 0; i < match.context.length; i++) {
      const line = match.context[i];
      const lineNum = match.lineNumber - match.matchLine + i;
      const lineNumStr = lineNum.toString().padStart(6);
      
      if (i === match.matchLine) {
        // Highlight the matching line
        const highlighted = line.replace(
          new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
          (match) => chalk.bgYellow.black(match)
        );
        
        // Wrap the line
        const wrapped = wrapLine(highlighted, maxLineWidth);
        for (let j = 0; j < wrapped.length; j++) {
          const prefix = j === 0 ? chalk.green(`>${lineNumStr}: `) : chalk.green(' '.repeat(lineNumWidth));
          output += prefix + wrapped[j] + '\n';
        }
      } else {
        // Wrap regular lines
        const wrapped = wrapLine(line, maxLineWidth);
        for (let j = 0; j < wrapped.length; j++) {
          const prefix = j === 0 ? chalk.gray(` ${lineNumStr}: `) : chalk.gray(' '.repeat(lineNumWidth));
          output += prefix + wrapped[j] + '\n';
        }
      }
    }
  }
  
  if (matches.length > maxMatches) {
    output += chalk.yellow(`\n... and ${matches.length - maxMatches} more match(es)\n`);
  }
  
  return output;
}

function parseFileTree(html, basePath = '') {
  const files = [];
  // Try multiple regex patterns
  const patterns = [
    /<a href="\/\?did=([^"]+)"[^>]*data-original-title="([^"]+)">([^<]+)<\/a>/g,
    /<a[^>]+href="\/\?did=([^"]+)"[^>]*data-original-title="([^"]+)"[^>]*>([^<]+)<\/a>/g,
    /href="\/\?did=([^"]+)"[^>]*title="([^"]+)"[^>]*>([^<]+)<\/a>/g
  ];

  for (const linkRegex of patterns) {
    let match;
    linkRegex.lastIndex = 0; // Reset regex
    
    while ((match = linkRegex.exec(html)) !== null) {
      const [, did, fullPath, fileName] = match;
      // Skip if we already have this file
      if (!files.find(f => f.did === did)) {
        files.push({
          did,
          fullPath: fullPath || fileName || '',
          fileName: fileName || fullPath || '',
          relativePath: (fullPath || fileName || '').replace(/^[^/]+\//, '')
        });
      }
    }
    
    if (files.length > 0) {
      break;
    }
  }

  return files;
}

async function downloadFile(fileSystemId, bucket) {
  const url = `${BASE_URL}/file/read?type=1&systemid=${fileSystemId}&k=${API_KEY}&bucket=${bucket}`;
  
  const response = await fetch(url, {
    credentials: 'omit',
    headers: getHeaders(),
    method: 'GET',
    mode: 'cors'
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  return await response.arrayBuffer();
}

async function createZip(files, outputPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    for (const file of files) {
      archive.append(Buffer.from(file.data), { name: file.path });
    }

    archive.finalize();
  });
}

async function main() {
  program
    .name('intelx')
    .description('Download files from intelx.io')
    .version('1.0.0')
    .argument('[query]', 'Query or system ID to search for (e.g., example@email.com or 1d69f42e-3e31-46cc-a349-0870d07b3b61)')
    .option('-o, --output <path>', 'Output zip file path (default: ./<query>.zip in current directory)')
    .addHelpText('after', `
Examples:
  $ intelx example@email.com
  $ intelx 1d69f42e-3e31-46cc-a349-0870d07b3b61 -o custom-name.zip
  $ intelx
  (will prompt for query)

Note:
  - Requires INTELX_API_KEY in .env file
  - Files are saved to current directory by default
  - You'll be prompted to select which files to download
    `)
    .action(async (systemId, options) => {
      // Main menu loop
      while (true) {
        try {
          // Show menu if no systemId provided
          if (!systemId) {
            const menuChoices = [
            { name: 'Search', value: 'search' },
            { name: 'Set API Key', value: 'setkey' },
            { name: 'API Limits', value: 'limits' }
          ];

          const { action } = await inquirer.prompt([
            {
              type: 'list',
              name: 'action',
              message: 'What would you like to do?',
              choices: menuChoices
            }
          ]);

          if (action === 'setkey') {
            const { apiKey } = await inquirer.prompt([
              {
                type: 'input',
                name: 'apiKey',
                message: 'Enter your IntelX API key:',
                validate: (input) => {
                  if (!input || input.trim().length === 0) {
                    return 'API key is required';
                  }
                  return true;
                }
              }
            ]);
            setApiKey(apiKey.trim());
            API_KEY = apiKey.trim();
            console.log(chalk.green('\n✓ API key saved successfully!'));
            // Continue loop to show menu again
            continue;
          }

          if (action === 'limits') {
            if (!API_KEY) {
              console.error(chalk.red('\n✗ Error: API key not set. Please set it first using "Set API Key" option.'));
              // Continue loop to show menu again
              continue;
            }
            console.log(chalk.cyan('\nFetching API limits...'));
            const limits = await getApiLimits();
            
            console.log(chalk.bold.cyan('\nAPI Limits:'));
            console.log(chalk.white(`Active Searches: ${chalk.yellow(limits.searchesactive)} / ${chalk.yellow(limits.maxconcurrentsearches)}`));
            console.log(chalk.bold.cyan('\nEndpoint Credits:'));
            
            // Display credits in a formatted table
            const paths = Object.entries(limits.paths || {});
            const maxPathWidth = Math.max(...paths.map(([path]) => path.length), 20);
            
            // Compute max digits for credit & max to align the top line better
            let maxCreditDigits = 0;
            let maxMaxDigits = 0;
            for (const [, info] of paths) {
              if (info.CreditMax > 0) {
                maxCreditDigits = Math.max(maxCreditDigits, (info.Credit || 0).toString().length);
                maxMaxDigits = Math.max(maxMaxDigits, (info.CreditMax || 0).toString().length);
              }
            }
            const creditMaxWidth = Math.max(maxCreditDigits, maxMaxDigits, 4);
            for (const [path, info] of paths) {
              if (info.CreditMax > 0) {
                const pathPadded = path.padEnd(maxPathWidth);
                const credit = info.Credit || 0;
                const max = info.CreditMax;
                const reset = info.CreditReset || 0;
                const percentage = ((credit / max) * 100).toFixed(1);
                const percentageStr = `(${percentage.padStart(5)}%)`.padEnd(9);
                const barLength = 20;
                const filled = Math.round((credit / max) * barLength);
                const barFilled = chalk.green('█'.repeat(filled));
                const barEmpty = chalk.gray('░'.repeat(barLength - filled));
                const bar = barFilled + barEmpty;
                const creditColor = credit < max * 0.1 ? chalk.red : credit < max * 0.5 ? chalk.yellow : chalk.green;
                console.log(
                  chalk.white(`  ${pathPadded} | ${creditColor(credit
                    .toString()
                    .padStart(creditMaxWidth))}/${chalk.white(max
                    .toString()
                    .padStart(creditMaxWidth))} ${chalk.cyan(percentageStr)} | Reset: ${chalk.yellow(reset)}h | [${bar}]`)
                );
              }
            }
            
            // Continue loop to show menu again
            console.log(chalk.gray('\nPress Enter to return to menu...'));
            await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
            console.clear();
            continue;
          }

          // If search was selected, prompt for query
          const { inputSystemId } = await inquirer.prompt([
            {
              type: 'input',
              name: 'inputSystemId',
              message: 'Enter query or system ID to search for:',
              validate: (input) => {
                if (!input || input.trim().length === 0) {
                  return 'Query or system ID is required';
                }
                return true;
              }
            }
          ]);
            systemId = inputSystemId.trim();
          }

          // Check if API key is set
          if (!API_KEY) {
            console.error(chalk.red('\n✗ Error: API key not set. Please run the script without arguments and select "Set API Key" to configure it.'));
            systemId = null; // Reset to show menu again
            continue;
          }

          // Use systemId as default output filename if not specified
          // Save to current working directory
          const defaultFilename = `${systemId}.zip`;
          const outputPath = options.output 
            ? (path.isAbsolute(options.output) ? options.output : path.join(process.cwd(), options.output))
            : path.join(process.cwd(), defaultFilename);
          console.log(chalk.cyan(`\nSearching for: ${chalk.bold.white(systemId)}`));
          
          // Step 1: Search
          const searchId = await searchBySystemId(systemId);

          // Step 2: Get results
          const results = await getSearchResults(searchId);
          
          if (!results.records || results.records.length === 0) {
            console.error(chalk.red('✗ No records found'));
            systemId = null; // Reset to show menu again
            continue;
          }

          console.log(chalk.green(`✓ Found ${chalk.bold.yellow(results.records.length)} record(s)\n`));

          // Ask user how they want to proceed
          const { action } = await inquirer.prompt([
            {
              type: 'list',
              name: 'action',
              message: 'What would you like to do?',
              choices: [
                { name: 'Preview files (show context around search term)', value: 'preview' },
                { name: 'Download files directly from results', value: 'results' },
                { name: 'View file tree of a specific record', value: 'tree' }
              ]
            }
          ]);

          if (action === 'preview') {
            // Preview files with pagination
            let currentPage = 0;
            const pageSize = 1; // Show one file at a time
            const totalPages = results.records.length;
            const preloadedContent = new Map(); // Cache for preloaded content
            let lastAction = null; // Track last action for default selection

            // Helper function to preload next page
            const preloadNext = async (pageIndex) => {
              if (pageIndex >= totalPages || preloadedContent.has(pageIndex)) {
                return;
              }
              const record = results.records[pageIndex];
              try {
                const content = await getFilePreview(record.storageid, record.bucket);
                preloadedContent.set(pageIndex, content);
              } catch (error) {
                // Silently fail preload, will load on demand
              }
            };

            while (true) {
              const record = results.records[currentPage];
              const fileName = record.name ? record.name.split('/').pop() : 'Unknown';
              const date = record.date ? new Date(record.date).toLocaleDateString() : 'Unknown date';
              const size = record.size ? `${(record.size / 1024 / 1024).toFixed(2)} MB` : 'Unknown size';
              const bucket = record.bucketh || record.bucket || 'Unknown bucket';

              console.clear();
              console.log(chalk.bold.cyan(`\nFile Preview (${currentPage + 1}/${totalPages})\n`));
              console.log(chalk.white(`File: ${chalk.bold.yellow(fileName)}`));
              console.log(chalk.white(`Date: ${chalk.gray(date)} | Size: ${chalk.gray(size)} | Bucket: ${chalk.gray(bucket)}\n`));

              try {
                // Check if content is preloaded, otherwise load it
                let content;
                if (preloadedContent.has(currentPage)) {
                  content = preloadedContent.get(currentPage);
                } else {
                  console.log(chalk.cyan('Loading file content...'));
                  content = await getFilePreview(record.storageid, record.bucket);
                  preloadedContent.set(currentPage, content);
                }
                
                const matches = findContextInFile(content, systemId, 5);
                const preview = formatPreview(matches, systemId, 3);
                console.log(preview);
              } catch (error) {
                console.log(chalk.red(`Error loading preview: ${error.message}`));
              }

              // Preload next page in background
              if (currentPage < totalPages - 1) {
                preloadNext(currentPage + 1);
              }

              const choices = [];
              if (currentPage < totalPages - 1) {
                choices.push({ name: 'Next →', value: 'next' });
              }
              if (currentPage > 0) {
                choices.push({ name: '← Previous', value: 'prev' });
              }
              choices.push({ name: 'Download this file', value: 'download' });
              choices.push({ name: 'Back to menu', value: 'back' });

              // Determine default based on last action and availability
              let defaultChoice = null;
              if (lastAction === 'next' && currentPage < totalPages - 1) {
                defaultChoice = 'next';
              } else if (lastAction === 'prev' && currentPage > 0) {
                defaultChoice = 'prev';
              } else if (choices.length > 0) {
                // Default to first available choice
                defaultChoice = choices[0].value;
              }

              const { nextAction } = await inquirer.prompt([
                {
                  type: 'list',
                  name: 'nextAction',
                  message: 'What would you like to do?',
                  choices: choices,
                  default: defaultChoice
                }
              ]);

              // Remember the action for next iteration
              if (nextAction === 'next' || nextAction === 'prev') {
                lastAction = nextAction;
              }

              if (nextAction === 'prev') {
                currentPage--;
              } else if (nextAction === 'next') {
                currentPage++;
              } else if (nextAction === 'download') {
                // Download this file directly (no zip)
                console.log(chalk.cyan(`\nDownloading: ${fileName}...`));
                try {
                  const data = await downloadFile(record.systemid, record.bucket);
                  const filePath = path.join(process.cwd(), fileName);
                  await writeFile(filePath, Buffer.from(data));
                  console.log(chalk.green(`✓ Downloaded to ${chalk.bold.cyan(filePath)}`));
                } catch (error) {
                  console.log(chalk.red(`✗ Error: ${error.message}`));
                }
                // Continue browsing - loop will continue and show menu again
              } else if (nextAction === 'back') {
                console.clear();
                systemId = null; // Reset to return to main menu
                break;
              }
            }
            // If we broke from preview, continue to show main menu
            if (systemId === null) {
              continue;
            }
          }

        if (action === 'results') {
          // Download directly from results
          const recordChoices = results.records.map((rec, index) => {
            const name = rec.name ? rec.name.split('/').pop() : 'Unknown';
            const date = rec.date ? new Date(rec.date).toLocaleDateString() : 'Unknown date';
            const size = rec.size ? `${(rec.size / 1024 / 1024).toFixed(2)} MB` : 'Unknown size';
            const bucket = rec.bucketh || rec.bucket || 'Unknown bucket';
            return {
              name: `${name} | ${date} | ${size} | ${bucket}`,
              value: index
            };
          });

          // Calculate maximum widths for alignment
          const maxNameWidth = Math.max(...recordChoices.map(r => r.name.split(' | ')[0].length), 30);
          const maxDateWidth = Math.max(...recordChoices.map(r => r.name.split(' | ')[1]?.length || 0), 10);
          const maxSizeWidth = Math.max(...recordChoices.map(r => r.name.split(' | ')[2]?.length || 0), 8);

          const alignedChoices = recordChoices.map((choice, index) => {
            const parts = choice.name.split(' | ');
            const namePadded = parts[0].padEnd(maxNameWidth);
            const datePadded = (parts[1] || '').padEnd(maxDateWidth);
            const sizePadded = (parts[2] || '').padEnd(maxSizeWidth);
            const bucket = parts[3] || '';
            return {
              name: `${namePadded} | ${datePadded} | ${sizePadded} | ${bucket}`,
              value: index,
              checked: true
            };
          });

          const terminalRows = process.stdout.rows || 24;
          const pageSize = Math.max(10, Math.min(alignedChoices.length + 2, terminalRows - 5));

          const { selectedIndices } = await inquirer.prompt([
            {
              type: 'checkbox',
              name: 'selectedIndices',
              message: 'Select files to download:',
              choices: [
                { name: 'Select All', value: 'all' },
                new inquirer.Separator(),
                ...alignedChoices
              ],
              pageSize: pageSize,
              loop: false
            }
          ]);

          let filesToDownload;
          if (selectedIndices.includes('all')) {
            filesToDownload = results.records;
          } else {
            filesToDownload = selectedIndices.map(idx => results.records[idx]);
          }

          if (filesToDownload.length === 0) {
            console.log(chalk.yellow('No files selected'));
            systemId = null; // Reset to return to main menu
            continue;
          }

          console.log(chalk.cyan(`\nDownloading ${chalk.bold.yellow(filesToDownload.length)} files...\n`));

          // Download files directly from results
          const downloadedFiles = [];
          for (let i = 0; i < filesToDownload.length; i++) {
            const rec = filesToDownload[i];
            try {
              const fileName = rec.name ? rec.name.split('/').pop() : `file_${rec.systemid}.txt`;
              process.stdout.write(chalk.white(`[${i + 1}/${filesToDownload.length}] Downloading: ${chalk.cyan(fileName)}... `));
              const data = await downloadFile(rec.systemid, rec.bucket);
              downloadedFiles.push({
                path: fileName,
                data: data
              });
              console.log(chalk.green('✓'));
            } catch (error) {
              console.log(chalk.red(`✗ Error: ${error.message}`));
            }
          }

          // Create zip
          if (downloadedFiles.length > 0) {
            await createZip(downloadedFiles, outputPath);
            console.log(chalk.green(`\n✓ Downloaded ${chalk.bold.yellow(downloadedFiles.length)} files to ${chalk.bold.cyan(outputPath)}`));
          } else {
            console.log(chalk.red('\n✗ No files were successfully downloaded'));
          }

          systemId = null; // Reset to return to main menu
          continue;
        }

        if (action === 'tree') {
          // View file tree - need to select a record first
          let record;
          if (results.records.length === 1) {
            record = results.records[0];
          } else {
            // Multiple records found, ask user to select one for file tree
            const recordData = results.records.map((rec) => {
              const name = rec.name ? rec.name.split('/').pop() : 'Unknown';
              const date = rec.date ? new Date(rec.date).toLocaleDateString() : 'Unknown date';
              const size = rec.size ? `${(rec.size / 1024 / 1024).toFixed(2)} MB` : 'Unknown size';
              const bucket = rec.bucketh || rec.bucket || 'Unknown bucket';
              return { name, date, size, bucket };
            });

            // Calculate maximum widths for each column
            const maxNameWidth = Math.max(...recordData.map(r => r.name.length), 30);
            const maxDateWidth = Math.max(...recordData.map(r => r.date.length), 10);
            const maxSizeWidth = Math.max(...recordData.map(r => r.size.length), 8);

            // Format with aligned columns
            const recordChoices = recordData.map((rec, index) => {
              const namePadded = rec.name.padEnd(maxNameWidth);
              const datePadded = rec.date.padEnd(maxDateWidth);
              const sizePadded = rec.size.padEnd(maxSizeWidth);
              return {
                name: `${namePadded} | ${datePadded} | ${sizePadded} | ${rec.bucket}`,
                value: index
              };
            });

            // Calculate page size based on terminal height
            const terminalRows = process.stdout.rows || 24;
            const pageSize = Math.max(10, Math.min(recordChoices.length, terminalRows - 5));

            const { selectedIndex } = await inquirer.prompt([
              {
                type: 'list',
                name: 'selectedIndex',
                message: `Select a record to view its file tree:`,
                choices: recordChoices,
                pageSize: pageSize,
                loop: false
              }
            ]);

            record = results.records[selectedIndex];
          }

          // Continue with file tree download
          const indexFile = record.indexfile;
          const storageId = record.storageid;
          const bucket = record.bucket;

          if (!indexFile || !bucket) {
            console.error(chalk.red('✗ Missing indexfile or bucket in results'));
            systemId = null; // Reset to return to main menu
            continue;
          }

          const recordName = record.name ? record.name.split('/').pop() : 'Unknown';
          console.log(chalk.green(`✓ Found: ${chalk.bold.white(recordName)}`));

          // Step 3: Get file tree
          console.log(chalk.cyan('Fetching file tree...'));
          const treeHtml = await getFileTree(indexFile, bucket);
          const files = parseFileTree(treeHtml);

          if (files.length === 0) {
            console.error(chalk.red('✗ No files found in tree'));
            systemId = null; // Reset to return to main menu
            continue;
          }

          console.log(chalk.green(`✓ Found ${chalk.bold.yellow(files.length)} files\n`));

          // Step 4: Show files and let user select
          const fileChoices = files.map((file, index) => ({
            name: file.relativePath || file.fileName,
            value: index,
            checked: true
          }));

          // Calculate page size based on terminal height
          const terminalRows = process.stdout.rows || 24;
          const filePageSize = Math.max(10, Math.min(fileChoices.length + 2, terminalRows - 5));

          const { selectedIndices } = await inquirer.prompt([
            {
              type: 'checkbox',
              name: 'selectedIndices',
              message: 'Select files to download:',
              choices: [
                { name: 'Select All', value: 'all' },
                new inquirer.Separator(),
                ...fileChoices
              ],
              pageSize: filePageSize,
              loop: false
            }
          ]);

          let filesToDownload;
          if (selectedIndices.includes('all')) {
            filesToDownload = files;
          } else {
            filesToDownload = selectedIndices.map(idx => files[idx]);
          }

          if (filesToDownload.length === 0) {
            console.log(chalk.yellow('No files selected'));
            systemId = null; // Reset to return to main menu
            continue;
          }

          console.log(chalk.cyan(`\nDownloading ${chalk.bold.yellow(filesToDownload.length)} files...\n`));

          // Step 5: Download files
          const downloadedFiles = [];
          for (let i = 0; i < filesToDownload.length; i++) {
            const file = filesToDownload[i];
            try {
              process.stdout.write(chalk.white(`[${i + 1}/${filesToDownload.length}] Downloading: ${chalk.cyan(file.relativePath || file.fileName)}... `));
              // Use the file's did as its systemid for download
              const data = await downloadFile(file.did, bucket);
              downloadedFiles.push({
                path: file.relativePath,
                data: data
              });
              console.log(chalk.green('✓'));
            } catch (error) {
              console.log(chalk.red(`✗ Error: ${error.message}`));
            }
          }

          // Step 6: Create zip
          if (downloadedFiles.length > 0) {
            await createZip(downloadedFiles, outputPath);
            console.log(chalk.green(`\n✓ Downloaded ${chalk.bold.yellow(downloadedFiles.length)} files to ${chalk.bold.cyan(outputPath)}`));
          } else {
            console.log(chalk.red('\n✗ No files were successfully downloaded'));
          }

          systemId = null; // Reset to return to main menu
          continue;
        }
        } catch (error) {
          console.error(chalk.red(`\n✗ Error: ${error.message}`));
          systemId = null; // Reset to return to main menu on error
          continue;
        }
      }
    });

  program.configureHelp({
    showGlobalOptions: true
  });

  program.parse();
}

main();

