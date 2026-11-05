const fs = require('fs');
const path = require('path');

const CAMINHO_ARQUIVO = path.join(__dirname, 'leads.json');
const CAMINHO_CSV_CRM = path.join(__dirname, 'leads_prontos_crm.csv');
const CABECALHO_CSV_CRM = [
    'Opportunity name',
    'Contact Name',
    'phone',
    'email',
    'pipeline',
    'stage',
    'Lead Value',
    'source',
    'assigned',
    'lost reason name',
    'Followers',
    'Notes',
    'tags',
    'status',
    'Expected Close Date',
    'Forecast Probability',
    'Data da venda',
    'Opportunity ID',
    'Contact ID'
];

fs.writeFileSync(CAMINHO_ARQUIVO, '[]\n', 'utf8');
fs.writeFileSync(
    CAMINHO_CSV_CRM,
    `${CABECALHO_CSV_CRM.map(valor => `"${valor.replace(/"/g, '""')}"`).join(',')}\r\n`,
    'utf8'
);

console.log('Leads apagados com sucesso.');
console.log(`JSON limpo: ${CAMINHO_ARQUIVO}`);
console.log(`CSV limpo, mantendo o cabeçalho: ${CAMINHO_CSV_CRM}`);
