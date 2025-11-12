#!/usr/bin/env node

import dotenv from 'dotenv';
import { program } from 'commander';
import inquirer from 'inquirer';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import path from 'path';

dotenv.config({ path: path.join(path.dirname(new URL(import.meta.url).pathname), '.env') });

const API_KEY = process.env.INTELX_API_KEY;
const BASE_URL = 'https://2.intelx.io';

if (!API_KEY) {
  console.error('Error: INTELX_API_KEY not found in .env file');
  process.exit(1);
}

const headers = {
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
      ...headers,
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
    headers: headers,
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
      ...headers,
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

async function getApiLimits() {
  const url = `${BASE_URL}/authenticate/info`;
  
  const response = await fetch(url, {
    credentials: 'omit',
    headers: headers,
    method: 'GET',
    mode: 'cors'
  });

  if (!response.ok) {
    throw new Error(`Get API limits failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
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
    headers: headers,
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
    .argument('[systemId]', 'System ID to search for (e.g., 1d69f42e-3e31-46cc-a349-0870d07b3b61)')
    .option('-o, --output <path>', 'Output zip file path (default: ./<systemId>.zip in current directory)')
    .addHelpText('after', `
Examples:
  $ intelx 1d69f42e-3e31-46cc-a349-0870d07b3b61
  $ intelx 1d69f42e-3e31-46cc-a349-0870d07b3b61 -o custom-name.zip
  $ intelx
  (will prompt for systemId)

Note:
  - Requires INTELX_API_KEY in .env file
  - Files are saved to current directory by default
  - You'll be prompted to select which files to download
    `)
    .action(async (systemId, options) => {
      try {
        // Show menu if no systemId provided
        if (!systemId) {
          const { action } = await inquirer.prompt([
            {
              type: 'list',
              name: 'action',
              message: 'What would you like to do?',
              choices: [
                { name: 'Search', value: 'search' },
                { name: 'API Limits', value: 'limits' }
              ]
            }
          ]);

          if (action === 'limits') {
            console.log('\nFetching API limits...');
            const limits = await getApiLimits();
            
            console.log('\nAPI Limits:');
            console.log(`Active Searches: ${limits.searchesactive} / ${limits.maxconcurrentsearches}`);
            console.log('\nEndpoint Credits:');
            
            // Display credits in a formatted table
            const paths = Object.entries(limits.paths || {});
            const maxPathWidth = Math.max(...paths.map(([path]) => path.length), 20);
            
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
                const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
                console.log(`  ${pathPadded} | ${credit.toString().padStart(4)}/${max.toString().padStart(4)} ${percentageStr} | Reset: ${reset}h | [${bar}]`);
              }
            }
            
            process.exit(0);
          }

          // If search was selected, prompt for systemId
          const { inputSystemId } = await inquirer.prompt([
            {
              type: 'input',
              name: 'inputSystemId',
              message: 'Enter system ID to search for:',
              validate: (input) => {
                if (!input || input.trim().length === 0) {
                  return 'System ID is required';
                }
                return true;
              }
            }
          ]);
          systemId = inputSystemId.trim();
        }

        // Use systemId as default output filename if not specified
        // Save to current working directory
        const defaultFilename = `${systemId}.zip`;
        const outputPath = options.output 
          ? (path.isAbsolute(options.output) ? options.output : path.join(process.cwd(), options.output))
          : path.join(process.cwd(), defaultFilename);
        console.log(`\nSearching for system ID: ${systemId}`);
        
        // Step 1: Search
        const searchId = await searchBySystemId(systemId);

        // Step 2: Get results
        const results = await getSearchResults(searchId);
        
        if (!results.records || results.records.length === 0) {
          console.error('❌ No records found');
          process.exit(1);
        }

        let record;
        if (results.records.length === 1) {
          record = results.records[0];
        } else {
          // Multiple records found, ask user to select
          // First, prepare all the data and calculate column widths
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
              message: `Found ${results.records.length} records. Select one:`,
              choices: recordChoices,
              pageSize: pageSize,
              loop: false
            }
          ]);

          record = results.records[selectedIndex];
        }

        const indexFile = record.indexfile;
        const storageId = record.storageid;
        const bucket = record.bucket;

        if (!indexFile || !bucket) {
          console.error('❌ Missing indexfile or bucket in results');
          process.exit(1);
        }

        const recordName = record.name ? record.name.split('/').pop() : 'Unknown';
        console.log(`Found: ${recordName}`);

        // Step 3: Get file tree
        console.log('Fetching file tree...');
        const treeHtml = await getFileTree(indexFile, bucket);
        const files = parseFileTree(treeHtml);

        if (files.length === 0) {
          console.error('❌ No files found in tree');
          process.exit(1);
        }

        console.log(`Found ${files.length} files\n`);

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
          console.log('No files selected');
          process.exit(0);
        }

        console.log(`\nDownloading ${filesToDownload.length} files...\n`);

        // Step 5: Download files
        const downloadedFiles = [];
        for (let i = 0; i < filesToDownload.length; i++) {
          const file = filesToDownload[i];
          try {
            process.stdout.write(`[${i + 1}/${filesToDownload.length}] Downloading: ${file.relativePath || file.fileName}... `);
            // Use the file's did as its systemid for download
            const data = await downloadFile(file.did, bucket);
            downloadedFiles.push({
              path: file.relativePath,
              data: data
            });
            console.log('✓');
          } catch (error) {
            console.log(`✗ Error: ${error.message}`);
          }
        }

        // Step 6: Create zip
        if (downloadedFiles.length > 0) {
          await createZip(downloadedFiles, outputPath);
          console.log(`\n✅ Downloaded ${downloadedFiles.length} files to ${outputPath}`);
        } else {
          console.log('\n❌ No files were successfully downloaded');
        }

      } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        process.exit(1);
      }
    });

  program.configureHelp({
    showGlobalOptions: true
  });

  program.parse();
}

main();

