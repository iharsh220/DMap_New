/**
 * SQL Merge Script - Complete Replace with ALL Data + New Schema Columns
 * Simple and working version
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
            let createStmt = createMatch[0];
            
            // Add PRIMARY KEY and AUTO_INCREMENT if missing
            // Find the id column and add AUTO_INCREMENT
            const idMatch = createStmt.match(/`id` int\(11\) NOT NULL(,|\))/);
            if (idMatch) {
                const replacement = idMatch[1] === ',' 
                    ? '`id` int(11) NOT NULL AUTO_INCREMENT,'
                    : '`id` int(11) NOT NULL AUTO_INCREMENT';
                createStmt = createStmt.replace(idMatch[0], replacement);
            }
            
            // Add PRIMARY KEY (id) before the closing parenthesis
            if (!createStmt.includes('PRIMARY KEY')) {
                // Replace ) ENGINE=InnoDB with , PRIMARY KEY (`id`) ENGINE=InnoDB
                createStmt = createStmt.replace(
                    /\) ENGINE=InnoDB/,
                    ',  PRIMARY KEY (`id`)) ENGINE=InnoDB'
                );
            }
            
            createTables.push({
                name: tableName,
                create: '-- --------------------------------------------------------\n' + 
                       '-- Table structure for table `' + tableName + '`\n' +
                       '-- --------------------------------------------------------\n\n' + 
                       createStmt
            });
        }
    }
}
console.log(`   Schema: ${createTables.length} tables`);

// New columns that exist in new schema but not in old data
const tablesWithNewCols = {
    'tasks': {
        cols: ['version', 'assignment_type', 'intimate_client', 'review', 'review_stage', 
            'shared_with_client_at', 'no_of_options_provided', 'no_of_words_written', 
            'options_submitted', 'concept_work', 'resize_work', 'no_of_concepts', 
            'duration_minutes', 'duration_seconds', 'product_shoot', 'no_of_products_shot', 
            'shoot_setup', 'no_of_resize', 'responsive_screen', 'no_of_responsive_screen', 'comments'],
        defaults: ["'V1'", "'new'", '0', "'pending'", "'not_started'", 'NULL', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', 'NULL']
    },
    'issue_assignments': {
        cols: ['version', 'intimate_client', 'review', 'review_stage', 
            'shared_with_client_at', 'no_of_options_provided', 'no_of_words_written', 
            'options_submitted', 'concept_work', 'resize_work', 'no_of_concepts', 
            'duration_minutes', 'duration_seconds', 'product_shoot', 'no_of_products_shot', 
            'shoot_setup', 'no_of_resize', 'responsive_screen', 'no_of_responsive_screen', 'comments'],
        defaults: ["'V1'", '0', "'pending'", "'not_started'", 'NULL', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', 'NULL']
    },
    'task_documents': {
        cols: ['review', 'intimate_client'],
        defaults: ["'pending'", '0']
    },
    'issue_documents': {
        cols: ['review', 'intimate_client'],
        defaults: ["'pending'", '0']
    }
};

function addMissingColumns(sql, tableName) {
    if (!tablesWithNewCols[tableName]) return sql;
    
    // Check if already has new columns (check for 'review' column which is new in all tables)
    if (sql.includes('`review`') || sql.includes('`intimate_client`')) {
        return sql;
    }
    
    const config = tablesWithNewCols[tableName];
    const newColsStr = config.cols.map(c => `\`${c}\``).join(', ');
    const defaultsStr = config.defaults.join(', ');
    
    // Get column list
    const colMatch = sql.match(/INSERT INTO `[^`]+` \(([^)]+)\) VALUES/);
    if (!colMatch) return sql;
    
    const oldCols = colMatch[1];
    const newColumnList = oldCols + ', ' + newColsStr;
    
    // Replace column list
    let newSql = sql.replace(
        /INSERT INTO `[^`]+` \([^)]+\) VALUES/,
        `INSERT INTO \`${tableName}\` (${newColumnList}) VALUES`
    );
    
    // For each value row, add defaults before the closing parenthesis
    // Pattern: values ending with ), or );
    // We need to match each row's closing paren and add defaults BEFORE it
    
    // Split into lines and process each line
    const lines = newSql.split('\n');
    const processedLines = lines.map(line => {
        // For lines that end with ), or );  - these are data rows
        // We need to insert defaults before the closing )
        if (line.trim().endsWith('),') || line.trim().endsWith(');')) {
            // Find the last ) in the line and add defaults before it
            // But only if defaults not already added
            if (!line.includes(defaultsStr)) {
                // Match: anything followed by ), or );
                return line.replace(/(\))([,;]\s*)$/, `, ${defaultsStr}$1$2`);
            }
        }
        return line;
    });
    
    newSql = processedLines.join('\n');
    
    return newSql;
}

// Parse ALL INSERT statements from old file
const allInserts = [];
const oldLines = oldContent.split('\n');
let currentTable = '';
let inInsert = false;
let insertLines = [];

for (let i = 0; i < oldLines.length; i++) {
    const line = oldLines[i];
    
    const tableMatch = line.match(/Dumping data for table `([^`]+)`/);
    if (tableMatch) {
        currentTable = tableMatch[1];
    }
    
    if (line.includes('INSERT INTO')) {
        inInsert = true;
        insertLines = [line];
    }
    else if (inInsert) {
        insertLines.push(line);
        if (line.trim().endsWith(';')) {
            let fullInsert = insertLines.join('\n');
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

// Add common foreign key constraints manually based on schema
const fkConstraints = [
    "ALTER TABLE `change_issue_tasktype` ADD CONSTRAINT `fk_issue_reference` FOREIGN KEY (`change_issue_id`) REFERENCES `issue_register` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `fk_task_reference` FOREIGN KEY (`task_id`) REFERENCES `task_type` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `designation_departments` ADD CONSTRAINT `designation_departments_ibfk_1` FOREIGN KEY (`designation_id`) REFERENCES `designation` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `designation_departments_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `department` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `designation_jobroles` ADD CONSTRAINT `designation_jobroles_ibfk_1` FOREIGN KEY (`designation_id`) REFERENCES `designation` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `designation_jobroles_ibfk_2` FOREIGN KEY (`jobrole_id`) REFERENCES `job_role` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `fk_jobroles_department` FOREIGN KEY (`department_id`) REFERENCES `department` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;",
    "ALTER TABLE `division` ADD CONSTRAINT `division_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `department` (`id`);",
    "ALTER TABLE `issue_assignments` ADD CONSTRAINT `issue_assignments_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `issue_assignments_ibfk_2` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `issue_assignment_types` ADD CONSTRAINT `issue_assignment_types_ibfk_1` FOREIGN KEY (`issue_assignment_id`) REFERENCES `issue_assignments` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `issue_assignment_types_ibfk_2` FOREIGN KEY (`issue_register_id`) REFERENCES `issue_register` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `issue_documents` ADD CONSTRAINT `issue_documents_ibfk_1` FOREIGN KEY (`issue_user_assignment_id`) REFERENCES `issue_user_assignments` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `issue_user_assignments` ADD CONSTRAINT `issue_user_assignments_ibfk_1` FOREIGN KEY (`issue_assignment_id`) REFERENCES `issue_assignments` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `issue_user_assignments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `job_role` ADD CONSTRAINT `job_role_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `department` (`id`) ON DELETE SET NULL;",
    "ALTER TABLE `project_request_reference` ADD CONSTRAINT `project_request_reference_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `project_type` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `project_request_reference_ibfk_2` FOREIGN KEY (`request_id`) REFERENCES `request_type` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `request_division_reference` ADD CONSTRAINT `request_division_reference_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `request_type` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `request_division_reference_ibfk_2` FOREIGN KEY (`division_id`) REFERENCES `division` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `sales` ADD CONSTRAINT `sales_ibfk_1` FOREIGN KEY (`division_id`) REFERENCES `division` (`id`) ON DELETE SET NULL;",
    "ALTER TABLE `tasks` ADD CONSTRAINT `tasks_ibfk_2` FOREIGN KEY (`task_type_id`) REFERENCES `task_type` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `tasks_ibfk_3` FOREIGN KEY (`work_request_id`) REFERENCES `work_requests` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `tasks_ibfk_4` FOREIGN KEY (`request_type_id`) REFERENCES `request_type` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `task_assignments` ADD CONSTRAINT `task_assignments_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `task_assignments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `task_dependencies` ADD CONSTRAINT `task_dependencies_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `task_dependencies_ibfk_2` FOREIGN KEY (`dependency_task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `task_documents` ADD CONSTRAINT `task_documents_ibfk_1` FOREIGN KEY (`task_assignment_id`) REFERENCES `task_assignments` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `task_project_reference` ADD CONSTRAINT `task_project_reference_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `task_type` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `users` ADD CONSTRAINT `users_ibfk_1` FOREIGN KEY (`designation_id`) REFERENCES `designation` (`id`) ON DELETE SET NULL;",
    "ALTER TABLE `user_divisions` ADD CONSTRAINT `user_divisions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `user_divisions_ibfk_2` FOREIGN KEY (`division_id`) REFERENCES `division` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `work_requests` ADD CONSTRAINT `work_requests_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `work_requests_ibfk_2` FOREIGN KEY (`request_type_id`) REFERENCES `request_type` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `work_requests_ibfk_3` FOREIGN KEY (`project_id`) REFERENCES `project_type` (`id`) ON DELETE SET NULL;",
    "ALTER TABLE `work_request_documents` ADD CONSTRAINT `work_request_documents_ibfk_1` FOREIGN KEY (`work_request_id`) REFERENCES `work_requests` (`id`) ON DELETE CASCADE;",
    "ALTER TABLE `work_request_managers` ADD CONSTRAINT `work_request_managers_ibfk_1` FOREIGN KEY (`work_request_id`) REFERENCES `work_requests` (`id`) ON DELETE CASCADE, ADD CONSTRAINT `work_request_managers_ibfk_2` FOREIGN KEY (`manager_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;"
];

// Build merged file
let mergedContent = newHeader + '\n\n';

// Add foreign key checks disable at the beginning
mergedContent += 'SET FOREIGN_KEY_CHECKS=0;\n\n';
mergedContent += '-- ========================================================\n';
mergedContent += '-- SCHEMA FROM NEW FILE (UAT Structure)\n';
mergedContent += '-- ========================================================\n\n';

createTables.forEach(ct => {
    mergedContent += ct.create + '\n\n';
});

mergedContent += '\n-- ========================================================\n';
mergedContent += '-- DATA FROM OLD FILE (Complete Production Data)\n';
mergedContent += '-- ========================================================\n\n';

const insertsByTable = {};
allInserts.forEach(ins => {
    if (!insertsByTable[ins.table]) {
        insertsByTable[ins.table] = [];
    }
    insertsByTable[ins.table].push(ins.sql);
});

const tablesWithData = Object.keys(insertsByTable);
tablesWithData.forEach(tableName => {
    mergedContent += '-- --------------------------------------------------------\n';
    mergedContent += `-- Dumping data for table \`${tableName}\`\n`;
    mergedContent += '-- --------------------------------------------------------\n\n';
    
    insertsByTable[tableName].forEach(sql => {
        mergedContent += sql + '\n\n';
    });
});

mergedContent += '-- ========================================================\n';
mergedContent += '-- FOREIGN KEY CONSTRAINTS\n';
mergedContent += '-- ========================================================\n\n';

// Add foreign key constraints
fkConstraints.forEach(fk => {
    mergedContent += fk + '\n\n';
});

mergedContent += '-- ========================================================\n';
mergedContent += '-- END OF MIGRATION SQL\n';
mergedContent += '-- ========================================================\n';
mergedContent += 'COMMIT;\n\n';
mergedContent += 'SET FOREIGN_KEY_CHECKS=1;\n';

fs.writeFileSync(OUTPUT_FILE, mergedContent, 'utf8');

const stats = fs.statSync(OUTPUT_FILE);
console.log(`\n✅ Done! Output: ${OUTPUT_FILE} (${(stats.size / 1024).toFixed(2)} KB)`);
console.log('\n📋 Tables with data:');
tablesWithData.forEach(t => console.log(`   - ${t} (${insertsByTable[t].length} INSERTs)`));
