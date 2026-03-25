const fs = require('fs');

const newFilePath = './alembicdigilabs_Digi_dmap_25th_March_New.sql';
const oldFilePath = './alembicdigilabs_Digi_dmap_25th_March_Old.sql';

// Read both files
const newContent = fs.readFileSync(newFilePath, 'utf8');
const oldContent = fs.readFileSync(oldFilePath, 'utf8');

console.log('New file size:', newContent.length);
console.log('Old file size:', oldContent.length);

// Extract schema (CREATE TABLE statements) from new file
const schemaMatch = newContent.match(/CREATE TABLE[^;]+;/g);
console.log('Tables found in new file:', schemaMatch ? schemaMatch.length : 0);

// Parse INSERT statements and collect data
function parseInsertStatements(content) {
    const dataByTable = {};
    
    // Match INSERT INTO table_name values
    const insertRegex = /INSERT INTO `?(\w+)`?\s*\(([^)]+)\)\s*VALUES\s*([\s\S]*?);/gi;
    
    let match;
    while ((match = insertRegex.exec(content)) !== null) {
        const tableName = match[1];
        const columns = match[2].split(',').map(c => c.trim().replace(/`/g, ''));
        
        if (!dataByTable[tableName]) {
            dataByTable[tableName] = [];
        }
        
        // Parse the values - they can span multiple lines
        let valuesStr = match[3];
        
        // Split by ),( or ),\n(
        const valueRows = valuesStr.split(/\),\s*\(/);
        
        for (let row of valueRows) {
            row = row.trim();
            if (row.startsWith('(')) row = row.substring(1);
            if (row.endsWith(')')) row = row.slice(0, -1);
            if (row.endsWith(';')) row = row.slice(0, -1);
            
            // Parse values
            const values = [];
            let current = '';
            let inQuotes = false;
            let parenDepth = 0;
            
            for (let char of row) {
                if (char === "'" && !inQuotes) {
                    inQuotes = true;
                    current += char;
                } else if (char === "'" && inQuotes) {
                    inQuotes = false;
                    current += char;
                } else if (char === '(' && inQuotes) {
                    parenDepth++;
                    current += char;
                } else if (char === ')' && inQuotes) {
                    parenDepth--;
                    current += char;
                } else if (char === ',' && !inQuotes && parenDepth === 0) {
                    values.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            if (current.trim()) values.push(current.trim());
            
            // Create record with columns
            const record = {};
            columns.forEach((col, idx) => {
                let val = values[idx] || '';
                // Remove quotes if present
                if (val.startsWith("'") && val.endsWith("'")) {
                    val = val.slice(1, -1);
                }
                record[col] = val;
            });
            
            dataByTable[tableName].push(record);
        }
    }
    
    return dataByTable;
}

console.log('Parsing new file...');
const newData = parseInsertStatements(newContent);

console.log('Parsing old file...');
const oldData = parseInsertStatements(oldContent);

console.log('Tables in new:', Object.keys(newData));
console.log('Tables in old:', Object.keys(oldData));

// For each table, combine data (old data takes precedence if exists in both)
const mergedData = {};

for (let tableName of Object.keys(oldData)) {
    const newTableData = newData[tableName] || [];
    const oldTableData = oldData[tableName];
    
    // For lookup - use first column as key (usually id)
    const existingIds = new Set(newTableData.map(r => r.id));
    
    // Filter old data to get only records not in new
    const uniqueOldData = oldTableData.filter(r => !existingIds.has(r.id));
    
    console.log(`Table ${tableName}: ${newTableData.length} in new, ${oldTableData.length} in old, ${uniqueOldData.length} unique from old`);
    
    mergedData[tableName] = [...newTableData, ...uniqueOldData];
}

// Now generate merged SQL file
let mergedSQL = `-- phpMyAdmin SQL Dump
-- Merged from alembicdigilabs_Digi_dmap_25th_March_New.sql and alembicdigilabs_Digi_dmap_25th_March_Old.sql
-- Generated: ${new Date().toISOString()}

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

`;

if (schemaMatch) {
    for (let schema of schemaMatch) {
        mergedSQL += schema + '\n\n-- --------------------------------------------------------\n\n';
    }
}

// Generate INSERT statements for merged data
for (let tableName of Object.keys(mergedData)) {
    const records = mergedData[tableName];
    if (records.length === 0) continue;
    
    mergedSQL += `--\n-- Dumping data for table \`${tableName}\`\n--\n\nINSERT INTO \`${tableName}\` VALUES\n`;
    
    const valueStrings = records.map((r, idx) => {
        const values = Object.values(r).map(v => {
            if (v === null || v === undefined || v === '') return 'NULL';
            // Escape single quotes
            const escaped = v.replace(/'/g, "''");
            return `'${escaped}'`;
        });
        return `(${values.join(', ')})`;
    });
    
    // Split into batches of 1000 for MySQL
    const batchSize = 1000;
    for (let i = 0; i < valueStrings.length; i += batchSize) {
        const batch = valueStrings.slice(i, i + batchSize);
        mergedSQL += batch.join(',\n');
        if (i + batchSize < valueStrings.length) {
            mergedSQL += ',\n';
        } else {
            mergedSQL += ';\n';
        }
    }
    
    mergedSQL += '\n';
}

mergedSQL += '\nCOMMIT;\n';

fs.writeFileSync('./alembicdigilabs_Digi_dmap_Merged.sql', mergedSQL);
console.log('Merged file created: alembicdigilabs_Digi_dmap_Merged.sql');
console.log('Merged file size:', mergedSQL.length);
