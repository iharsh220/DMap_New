/**
 * SQL Merge Script - Complete Replace with ALL Data + New Schema Columns
 * Simple and robust version
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

// New columns that exist in new schema but not in old data
const newTaskColumns = [
    'version', 'assignment_type', 'intimate_client', 'review', 'review_stage', 
    'shared_with_client_at', 'no_of_options_provided', 'no_of_words_written', 
    'options_submitted', 'concept_work', 'resize_work', 'no_of_concepts', 
    'duration_minutes', 'duration_seconds', 'product_shoot', 'no_of_products_shot', 
    'shoot_setup', 'no_of_resize', 'responsive_screen', 'no_of_responsive_screen', 'comments'
];

const newIssueColumns = [
    'version', 'intimate_client', 'review', 'review_stage', 
    'shared_with_client_at', 'no_of_options_provided', 'no_of_words_written', 
    'options_submitted', 'concept_work', 'resize_work', 'no_of_concepts', 
    'duration_minutes', 'duration_seconds', 'product_shoot', 'no_of_products_shot', 
    'shoot_setup', 'no_of_resize', 'responsive_screen', 'no_of_responsive_screen', 'comments'
];

const newTaskDocColumns = ['review', 'intimate_client'];
const newIssueDocColumns = ['review', 'intimate_client'];

// Default values for new columns
const defaultValues = {
    'tasks': {
        'version': "'V1'",
        'assignment_type': "'new'",
        'intimate_client': '0',
        'review': "'pending'",
        'review_stage': "'not_started'",
        'shared_with_client_at': 'NULL',
        'no_of_options_provided': '0',
        'no_of_words_written': '0',
        'options_submitted': '0',
        'concept_work': '0',
        'resize_work': '0',
        'no_of_concepts': '0',
        'duration_minutes': '0',
        'duration_seconds': '0',
        'product_shoot': '0',
        'no_of_products_shot': '0',
        'shoot_setup': '0',
        'no_of_resize': '0',
        'responsive_screen': '0',
        'no_of_responsive_screen': '0',
        'comments': 'NULL'
    },
    'issue_assignments': {
        'version': "'V1'",
        'intimate_client': '0',
        'review': "'pending'",
        'review_stage': "'not_started'",
        'shared_with_client_at': 'NULL',
        'no_of_options_provided': '0',
        'no_of_words_written': '0',
        'options_submitted': '0',
        'concept_work': '0',
        'resize_work': '0',
        'no_of_concepts': '0',
        'duration_minutes': '0',
        'duration_seconds': '0',
        'product_shoot': '0',
        'no_of_products_shot': '0',
        'shoot_setup': '0',
        'no_of_resize': '0',
        'responsive_screen': '0',
        'no_of_responsive_screen': '0',
        'comments': 'NULL'
    },
    'task_documents': {
        'review': "'pending'",
        'intimate_client': '0'
    },
    'issue_documents': {
        'review': "'pending'",
        'intimate_client': '0'
    }
};

function getNewColumnsForTable(tableName) {
    if (tableName === 'tasks') return newTaskColumns;
    if (tableName === 'issue_assignments') return newIssueColumns;
    if (tableName === 'task_documents') return newTaskDocColumns;
    if (tableName === 'issue_documents') return newIssueDocColumns;
    return [];
}

function getDefaultsForTable(tableName) {
    return defaultValues[tableName] || {};
}

function addMissingColumns(sql, tableName) {
    const newCols = getNewColumnsForTable(tableName);
    if (newCols.length === 0) return sql;
    
    // Check if already has new columns
    if (sql.includes('`version`') || sql.includes('`assignment_type`')) {
        return sql; // Already has new columns
    }
    
    const defaults = getDefaultsForTable(tableName);
    
    // Get the column list and VALUES keyword
    const colMatch = sql.match(/INSERT INTO `[^`]+` \(([^)]+)\) VALUES/s);
    if (!colMatch) return sql;
    
    const oldCols = colMatch[1];
    const newColsQuoted = newCols.map(c => `\`${c}\``).join(', ');
    const newColumnList = oldCols + ', ' + newColsQuoted;
    
    // Build defaults string
    const defaultsStr = newCols.map(col => defaults[col]).join(', ');
    
    // Replace column list
    let newSql = sql.replace(
        /INSERT INTO `[^`]+` \([^)]+\) VALUES/s,
        `INSERT INTO \`${tableName}\` (${newColumnList}) VALUES`
    );
    
    // Fix each row - simple approach: replace ")," with ", defaults),"
    // We need to be careful not to break the structure
    
    // Split the SQL into lines and process
    const lines = newSql.split('\n');
    const processedLines = [];
    
    for (let line of lines) {
        // Check if this is a data row (starts with number or paren)
        if (line.trim().startsWith('(') && line.includes(',') && !line.includes('INSERT INTO')) {
            // Check if this line already has defaults (ends with all defaults)
            if (!line.includes("'V1'") && !line.includes("'pending'")) {
                // This is a data row without defaults - add them
                // Remove trailing comma and paren, add defaults
                line = line.replace(/,\s*$/, '') + ', ' + defaultsStr + ')';
            }
        }
        processedLines.push(line);
    }
    
    return processedLines.join('\n');
}

// Parse ALL INSERT statements from old file - get complete data
const allInserts = [];
const oldLines = oldContent.split('\n');
let currentTable = '';
let inInsert = false;
let insertLines = [];

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
        insertLines = [line];
    }
    // Continue INSERT
    else if (inInsert) {
        insertLines.push(line);
        if (line.trim().endsWith(';')) {
            // Save the complete INSERT
            let fullInsert = insertLines.join('\n');
            
            // Add missing columns for tables with new schema
            fullInsert = addMissingColumns(fullInsert, currentTable);
            
            if (fullInsert.includes('INSERT INTO')) {
                allInserts.push({
                    table: currentTable,
                    sql: fullInsert
                });
            }
            inInsert = false;
            insertLines = [];
        }
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
