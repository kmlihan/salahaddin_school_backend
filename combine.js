const fs = require('fs');
const path = require('path');

const outputFile = 'combined-backend.txt';
const directories = [
    'server/config',
    'server/middleware', 
    'server/controllers',
    'models',
    'routes',
    'utils'
];

let output = '';

directories.forEach(dir => {
    if (!fs.existsSync(dir)) return;
    
    fs.readdirSync(dir).forEach(file => {
        if (path.extname(file) === '.js') {
            const filePath = path.join(dir, file).replace(/\\/g, '/');
            const content = fs.readFileSync(filePath, 'utf8');
            
            output += `${filePath}\n`;
            output += `${content}\n\n`;
        }
    });
});

fs.writeFileSync(outputFile, output);
console.log(`Combined file created: ${outputFile}`);