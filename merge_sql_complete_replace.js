/**
 * SQL Merge Script - Complete Replace
 * 
 * Purpose: Merge SQL files with NEW schema + OLD data only
 * 
 * Input:
 * - alembicdigilabs_Digi_dmap_25th_March_New.sql (Schema + some data)
 * - alembicdigilabs_Digi_dmap_25th_March_Old.sql (Schema + full production data)
 * 
 * Output:
 * - alembicdigilabs_Digi_dmap_Complete_Migration.sql (New schema + Old data)
 * 
 * Logic:
 * - Take CREATE TABLE statements from NEW file (schema)
 * - Take ALL INSERT statements from OLD file (all production data)
 */

const fs = require('fs');
const path = require('path');

const NEW_FILE = 'alembicdigilabs_Digi_dmap_25th_March_New.sql';
const OLD_FILE = 'alembicdigilabs_Digi_dmap_25th_March_Old.sql';
const OUTPUT_FILE = 'alembicdigilabs_Digi_dmap_Complete_Migration.sql';

console.log('🔄 Starting SQL merge process...');
console.log('   Strategy: NEW schema + OLD data (complete replacement)\n');

// Read both files
console.log('📂 Reading files...');
const newContent = fs.readFileSync(NEW_FILE, 'utf8');
const oldContent = fs.readFileSync(OLD_FILE, 'utf8');

console.log(`   New file size: ${(newContent.length / 1024).toFixed(2)} KB`);
console.log(`   Old file size: ${(oldContent.length / 1024).toFixed(2)} KB`);

// Split new file into sections based on "--- --------------------------------------------------------"
const newSections = newContent.split(/-- --------------------------------------------------------/);
console.log(`   New file has ${newSections.length} sections`);

// Extract header from new file (first section contains database info)
const newHeader = newSections[0];
console.log('\n📋 Extracted header from NEW file...');

// Parse CREATE TABLE statements from new file
const createTables = [];
const tableNames = [];

for (let i = 1; i < newSections.length; i++) {
    const section = newSections[i];
    if (section.includes('Table structure for table')) {
        // Extract table name
        const nameMatch = section.match(/Table structure for table `([^`]+)`/);
        if (nameMatch) {
            const tableName = nameMatch[1];
            
            // Find the CREATE TABLE statement in this section
            const createMatch = section.match(/CREATE TABLE[^;]+;/s);
            if (createMatch) {
                createTables.push({
                    name: tableName,
                    create: '-- --------------------------------------------------------\n' + 
                           '-- Table structure for table `' + tableName + '`\n' +
                           '-- --------------------------------------------------------\n\n' + 
                           createMatch[0]
                });
                tableNames.push(tableName);
            }
        }
    }
}

console.log(`   Found ${createTables.length} CREATE TABLE statements in NEW file`);

// Parse ALL INSERT statements from old file
const oldSections = oldContent.split(/-- --------------------------------------------------------/);
const insertStatements = [];
const oldTableNames = [];

for (let i = 1; i < oldSections.length; i++) {
    const section = oldSections[i];
    if (section.includes('Dumping data for table')) {
        // Extract table name
        const nameMatch = section.match(/Dumping data for table `([^`]+)`/);
        if (nameMatch) {
            const tableName = nameMatch[1];
            
            // Find all INSERT statements in this section
            const insertRegex = /INSERT INTO `[^`]+`[^;]+;/gs;
            const matches = section.match(insertRegex);
            
            if (matches && matches.length > 0) {
                const fullInsert = '-- --------------------------------------------------------\n' +
                                  '-- Dumping data for table `' + tableName + '`\n' +
                                  '-- --------------------------------------------------------\n\n' +
                                  matches.join('\n');
                insertStatements.push({
                    name: tableName,
                    data: fullInsert
                });
                oldTableNames.push(tableName);
            }
        }
    }
}

console.log(`   Found ${insertStatements.length} tables with INSERT statements in OLD file`);

// Count total records
let totalOldRecords = 0;
insertStatements.forEach(tbl => {
    const insertData = tbl.data;
    const valuesMatches = insertData.match(/\),\n\(/g);
    if (valuesMatches) {
        totalOldRecords += valuesMatches.length + 1;
    } else {
        // Check for single values
        const singleMatch = insertData.match(/VALUES\s*\(/);
        if (singleMatch) {
            totalOldRecords += 1;
        }
    }
});
console.log(`   Total records in OLD file: ${totalOldRecords}`);

// Build the merged content
console.log('\n⚙️  Building merged SQL file...');

let mergedContent = newHeader + '\n\n';

// Add all CREATE TABLE from new file (schema only)
mergedContent += '-- ========================================================\n';
mergedContent += '-- SCHEMA FROM NEW FILE (UAT Structure)\n';
mergedContent += '-- ========================================================\n\n';

createTables.forEach(ct => {
    mergedContent += ct.create + '\n\n';
});

// Add all INSERT statements from old file (all production data)
mergedContent += '\n-- ========================================================\n';
mergedContent += '-- DATA FROM OLD FILE (Complete Production Data)\n';
mergedContent += '-- ========================================================\n\n';

insertStatements.forEach(tbl => {
    mergedContent += tbl.data + '\n\n';
});

// Add footer
mergedContent += '-- ========================================================\n';
mergedContent += '-- END OF MIGRATION SQL\n';
mergedContent += '-- ========================================================\n';
mergedContent += 'COMMIT;\n';

// Write the merged file
fs.writeFileSync(OUTPUT_FILE, mergedContent, 'utf8');

const outputStats = fs.statSync(OUTPUT_FILE);

console.log('\n✅ Merge completed successfully!');
console.log('\n📊 Summary:');
console.log(`   Output file: ${OUTPUT_FILE}`);
console.log(`   Output size: ${(outputStats.size / 1024).toFixed(2)} KB`);
console.log(`   Schema tables: ${createTables.length}`);
console.log(`   Data tables: ${insertStatements.length}`);
console.log(`   Total records: ${totalOldRecords}`);

// Show table details
console.log('\n📋 Tables in NEW schema:');
tableNames.forEach(t => console.log(`      ✓ ${t}`));

console.log('\n📋 Tables with data from OLD:');
oldTableNames.forEach(t => console.log(`      ✓ ${t}`));

// Check for tables in schema but no data
const tablesWithNoData = tableNames.filter(t => !oldTableNames.includes(t));
if (tablesWithNoData.length > 0) {
    console.log('\n⚠️  Tables in schema but no data from OLD:');
    tablesWithNoData.forEach(t => console.log(`      ! ${t}`));
}

console.log('\n✨ Migration SQL file is ready for use!');
console.log(`   File: ${OUTPUT_FILE}`);
