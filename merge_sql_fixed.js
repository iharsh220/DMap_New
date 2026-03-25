/**
 * SQL Merge Script - Complete Replace with ALL Data
 */

const fs = require('fs');
const NEW_FILE = 'alembicdigilabs_Digi_dmap_25th_March_New.sql';
const OLD_FILE = 'alembicdigilabs_Digi_dmap_25th_March_Old.sql';
const OUTPUT_FILE = 'alembicdigilabs_Digi_dmap_Complete_Migration.sql';

console.log('🔄 Starting SQL merge process...');

const newContent = fs.readFileSync(NEW_FILE, 'utf8');
const oldContent = fs.readFileSync(OLD_FILE, 'utf8');

console.log(`   New: ${(newContent.length / 1024).toFixed(2)} KB`);
console.log(`   Old: ${(oldContent.length / 1024).toFixed(2)} KB`);

// Get header from new file
const newSections = newContent.split(/-- --------------------------------------------------------/);
const newHeader = newSections[0];

// Parse CREATE TABLE statements
const createTables = [];
for (let i = 1; i < newSections.length; i++) {
    const section = newSections[i];
    const nameMatch = section.match(/Table structure for table `([^`]+)`/);
    if (nameMatch) {
        const tableName = nameMatch[1];
        const createMatch = section.match(/CREATE TABLE[^;]+;/s);
        if (createMatch) {
            createTables.push({
                name: tableName,
                create: '-- --------------------------------------------------------\n' + 
                       '-- Table structure for table `' + tableName + '`\n' +
                       '-- --------------------------------------------------------\n\n' + 
                       createMatch[0]
            });
        }
    }
}
console.log(`   Schema: ${createTables.length} tables`);

// Parse ALL INSERT statements from old file - get complete data
const allInserts = [];
const oldLines = oldContent.split('\n');
let currentTable = '';
let inInsert = false;
let insertLines = [];
let insertStart = -1;

for (let i = 0; i < oldLines.length; i++) {
    const line = oldLines[i];
    
    // Detect table name
    const tableMatch = line.match(/Dumping data for table `([^`]+)`/);
    if (tableMatch) {
        currentTable = tableMatch[1];
    }
    
    // Start of INSERT
    if (line.includes('INSERT INTO')) {
        inInsert = true;
        insertStart = i;
        insertLines = [line];
    }
    // Continue INSERT
    else if (inInsert && (line.trim().endsWith(';') || line.trim() === '')) {
        if (line.trim().endsWith(';')) {
            insertLines.push(line);
        }
        // Save the complete INSERT
        const fullInsert = insertLines.join('\n');
        if (fullInsert.includes('INSERT INTO')) {
            allInserts.push({
                table: currentTable,
                sql: fullInsert
            });
        }
        inInsert = false;
        insertLines = [];
    }
    else if (inInsert) {
        insertLines.push(line);
    }
}

console.log(`   Data: ${allInserts.length} INSERT statements`);

// Build merged file
let mergedContent = newHeader + '\n\n';
mergedContent += '-- ========================================================\n';
mergedContent += '-- SCHEMA FROM NEW FILE (UAT Structure)\n';
mergedContent += '-- ========================================================\n\n';

createTables.forEach(ct => {
    mergedContent += ct.create + '\n\n';
});

mergedContent += '\n-- ========================================================\n';
mergedContent += '-- DATA FROM OLD FILE (Complete Production Data)\n';
mergedContent += '-- ========================================================\n\n';

// Group inserts by table
const insertsByTable = {};
allInserts.forEach(ins => {
    if (!insertsByTable[ins.table]) {
        insertsByTable[ins.table] = [];
    }
    insertsByTable[ins.table].push(ins.sql);
});

// Output in order of schema
const tablesWithData = Object.keys(insertsByTable);
tablesWithData.forEach(tableName => {
    mergedContent += '-- --------------------------------------------------------\n';
    mergedContent += `-- Dumping data for table \`${tableName}\`\n`;
    mergedContent += '-- --------------------------------------------------------\n\n';
    
    // Combine all INSERT statements for this table
    insertsByTable[tableName].forEach(sql => {
        mergedContent += sql + '\n\n';
    });
});

mergedContent += '-- ========================================================\n';
mergedContent += '-- END OF MIGRATION SQL\n';
mergedContent += '-- ========================================================\n';
mergedContent += 'COMMIT;\n';

fs.writeFileSync(OUTPUT_FILE, mergedContent, 'utf8');

const stats = fs.statSync(OUTPUT_FILE);
console.log(`\n✅ Done! Output: ${OUTPUT_FILE} (${(stats.size / 1024).toFixed(2)} KB)`);
console.log('\n📋 Tables with data:');
tablesWithData.forEach(t => console.log(`   - ${t} (${insertsByTable[t].length} INSERTs)`));
