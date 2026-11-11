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

function escaparCsv(valor) {
    return `"${String(valor ?? '').replace(/"/g, '""')}"`;
}

function analisarCsv(conteudo) {
    const linhas = [];
    let linha = [];
    let valor = '';
    let dentroDeAspas = false;

    for (let indice = 0; indice < conteudo.length; indice++) {
        const caractere = conteudo[indice];

        if (caractere === '"') {
            if (dentroDeAspas && conteudo[indice + 1] === '"') {
                valor += '"';
                indice++;
            } else {
                dentroDeAspas = !dentroDeAspas;
            }
        } else if (caractere === ',' && !dentroDeAspas) {
            linha.push(valor);
            valor = '';
        } else if ((caractere === '\n' || caractere === '\r') && !dentroDeAspas) {
            if (caractere === '\r' && conteudo[indice + 1] === '\n') indice++;
            linha.push(valor);
            valor = '';
            if (linha.some(campo => campo !== '')) linhas.push(linha);
            linha = [];
        } else {
            valor += caractere;
        }
    }

    if (dentroDeAspas) {
        throw new Error(`CSV inválido: aspas não fechadas em ${CAMINHO_CSV_CRM}`);
    }

    if (valor !== '' || linha.length > 0) {
        linha.push(valor);
        if (linha.some(campo => campo !== '')) linhas.push(linha);
    }

    return linhas;
}

function normalizarNicho(nicho) {
    return nicho.trim().toLocaleLowerCase('pt-BR');
}

function obterNichoDoCsv(notas) {
    const correspondencia = String(notas).match(/(?:^|\r?\n)Nicho:\s*(.*?)(?:\r?\n|$)/);
    return correspondencia ? correspondencia[1].trim() : '';
}

function limparPorNicho(nicho) {
    const nichoNormalizado = normalizarNicho(nicho);
    const leads = JSON.parse(fs.readFileSync(CAMINHO_ARQUIVO, 'utf8'));
    if (!Array.isArray(leads)) {
        throw new Error(`${CAMINHO_ARQUIVO} precisa conter uma lista JSON`);
    }

    const leadsRestantes = leads.filter(lead =>
        normalizarNicho(String(lead && lead.nicho || '')) !== nichoNormalizado
    );
    const leadsRemovidosJson = leads.length - leadsRestantes.length;

    const linhas = analisarCsv(fs.readFileSync(CAMINHO_CSV_CRM, 'utf8'));
    if (linhas.length === 0) {
        throw new Error(`${CAMINHO_CSV_CRM} não contém um cabeçalho`);
    }

    const indiceNotas = linhas[0].indexOf('Notes');
    if (indiceNotas === -1) {
        throw new Error(`${CAMINHO_CSV_CRM} não contém a coluna "Notes"`);
    }

    const linhasRestantes = [
        linhas[0],
        ...linhas.slice(1).filter(linha =>
            normalizarNicho(obterNichoDoCsv(linha[indiceNotas])) !== nichoNormalizado
        )
    ];
    const leadsRemovidosCsv = linhas.length - linhasRestantes.length;

    fs.writeFileSync(CAMINHO_ARQUIVO, `${JSON.stringify(leadsRestantes, null, 2)}\n`, 'utf8');
    fs.writeFileSync(
        CAMINHO_CSV_CRM,
        `${linhasRestantes.map(linha => linha.map(escaparCsv).join(',')).join('\r\n')}\r\n`,
        'utf8'
    );

    console.log(`Leads do nicho "${nicho}" apagados com sucesso.`);
    console.log(`JSON: ${leadsRemovidosJson} removido(s), ${leadsRestantes.length} restante(s).`);
    console.log(`CSV: ${leadsRemovidosCsv} removido(s), ${linhasRestantes.length - 1} restante(s).`);
}

function limparTodos() {
    fs.writeFileSync(CAMINHO_ARQUIVO, '[]\n', 'utf8');
    fs.writeFileSync(
        CAMINHO_CSV_CRM,
        `${CABECALHO_CSV_CRM.map(escaparCsv).join(',')}\r\n`,
        'utf8'
    );

    console.log('Leads apagados com sucesso.');
    console.log(`JSON limpo: ${CAMINHO_ARQUIVO}`);
    console.log(`CSV limpo, mantendo o cabeçalho: ${CAMINHO_CSV_CRM}`);
}

const indiceNicho = process.argv.indexOf('--nicho');
const argumentoNicho = indiceNicho === -1 ? undefined : process.argv[indiceNicho + 1];

if (indiceNicho === -1) {
    limparTodos();
} else if (typeof argumentoNicho !== 'string' || !argumentoNicho.trim() || argumentoNicho.startsWith('--')) {
    throw new Error('Informe um nicho não vazio após --nicho. Ex.: node limpar_leads.js --nicho "Pet Shop"');
} else {
    limparPorNicho(argumentoNicho);
}
