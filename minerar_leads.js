const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

// ==========================================
// 1. CONFIGURAÇÕES E ARQUIVOS
// ==========================================
const CAMINHO_CONFIGURACAO = path.join(__dirname, 'config.json');
const MAX_FORA_DO_RAIO_SEGUIDOS = 8; // encerra a busca quando só aparecem resultados longe demais
const MAX_SITES_FALLBACK = 5;
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

// ==========================================
// 2. TERMINAL (CORES E AJUDA)
// ==========================================
const c = {
    reset: '\x1b[0m',
    negrito: '\x1b[1m',
    verde: '\x1b[32m',
    vermelho: '\x1b[31m',
    amarelo: '\x1b[33m',
    ciano: '\x1b[36m',
    cinza: '\x1b[90m'
};

function mostrarAjuda() {
    const config = carregarConfiguracao();
    console.log(`
${c.negrito}Minerador de Leads - Google Maps${c.reset}

Uso:
  node minerar_leads.js                      (modo interativo: pergunta as opções)
  node minerar_leads.js --local "Itajuba, MG" --raio 30

Opções:
  --local     Cidade, endereço ou coordenadas "lat,lng". Separe vários com ";"
              Ex.: --local "Itajuba, MG; Pouso Alegre, MG"
              Ex.: --local "-22.4256,-45.4528"
  --raio      Raio de atuação em km a partir do local (padrão: ${config.raio})
  --nichos    Segmentos separados por vírgula
              Ex.: --nichos "Pizzaria, Pet Shop, Academia"
  --meta      Leads válidos por nicho e local (padrão: ${config.meta})
  --pontos    Centros de busca por local, de 1 a 7 (padrão: ${config.pontos_busca || 7})
  --headless  Executa sem abrir a janela do navegador
  --incluir-com-site
              Inclui leads com site e pede confirmação (y/n) antes de salvar
  --assigned  Responsável exportado no CSV do CRM nesta execução
              Ex.: --assigned "Nome do responsável"
  --ajuda     Mostra esta mensagem

O campo "incluir_com_site" no config.json permite salvar leads que possuem site.
Quando true, o site aparece no terminal e o script pergunta se deve salvar (y/n).
`);
}

// ==========================================
// 3. FUNÇÕES UTILITÁRIAS E PERSISTÊNCIA
// ==========================================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fecharPaginaSegura(pagina) {
    if (!pagina) return;
    if (typeof pagina.isClosed === 'function' && pagina.isClosed()) return;
    try {
        await pagina.close();
    } catch (erro) {
        if (!/No target with given id|Target closed|Session closed/i.test(erro.message || '')) {
            console.log(`${c.amarelo}⚠️ Não foi possível fechar uma aba do navegador: ${erro.message}${c.reset}`);
        }
    }
}

async function fecharNavegadorSeguro(navegador) {
    if (!navegador) return;
    if (typeof navegador.isConnected === 'function' && !navegador.isConnected()) return;
    if (typeof navegador.connected === 'boolean' && !navegador.connected) return;
    try {
        await navegador.close();
    } catch (erro) {
        if (!/No target with given id|Target closed|Session closed/i.test(erro.message || '')) {
            console.log(`${c.amarelo}⚠️ Não foi possível fechar o navegador: ${erro.message}${c.reset}`);
        }
    }
}

function carregarConfiguracao() {
    try {
        const configuracao = JSON.parse(fs.readFileSync(CAMINHO_CONFIGURACAO, 'utf8'));
        if (!configuracao || typeof configuracao !== 'object' || Array.isArray(configuracao)) {
            throw new Error('o conteúdo precisa ser um objeto JSON');
        }

        if (typeof configuracao.local !== 'string' || !configuracao.local.trim()) {
            throw new Error('o campo "local" precisa ser um texto não vazio');
        }
        if (!Number.isFinite(Number(configuracao.raio)) || Number(configuracao.raio) <= 0) {
            throw new Error('o campo "raio" precisa ser um número maior que zero');
        }
        if (!Array.isArray(configuracao.nichos) ||
            configuracao.nichos.length === 0 ||
            configuracao.nichos.some(nicho => typeof nicho !== 'string' || !nicho.trim())) {
            throw new Error('o campo "nichos" precisa ser uma lista de textos não vazia');
        }
        if (!Number.isInteger(Number(configuracao.meta)) || Number(configuracao.meta) <= 0) {
            throw new Error('o campo "meta" precisa ser um número inteiro maior que zero');
        }
        if (configuracao.pontos_busca !== undefined &&
            (!Number.isInteger(Number(configuracao.pontos_busca)) || Number(configuracao.pontos_busca) < 1 || Number(configuracao.pontos_busca) > 7)) {
            throw new Error('o campo "pontos_busca" precisa ser um número inteiro entre 1 e 7');
        }
        if (typeof configuracao.headless !== 'boolean') {
            throw new Error('o campo "headless" precisa ser true ou false');
        }
        if (typeof configuracao.incluir_com_site !== 'boolean') {
            throw new Error('o campo "incluir_com_site" precisa ser true ou false');
        }
        if (typeof configuracao.assigned !== 'string') {
            throw new Error('o campo "assigned" precisa ser um texto');
        }

        return configuracao;
    } catch (erro) {
        throw new Error(`Não foi possível carregar ${CAMINHO_CONFIGURACAO}: ${erro.message}`);
    }
}

// Localiza um navegador instalado conforme o sistema operacional.
// Retorna undefined para o Puppeteer usar o Chromium que ele mesmo baixou.
// Você também pode forçar um caminho com a variável de ambiente CHROME_PATH.
function encontrarNavegador() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
        return process.env.CHROME_PATH;
    }

    let candidatos = [];

    if (process.platform === 'win32') {
        const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
        const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const localAppData = process.env['LOCALAPPDATA'] || '';

        candidatos = [
            path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        ];
    } else if (process.platform === 'darwin') {
        candidatos = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    } else {
        candidatos = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
    }

    return candidatos.find(p => p && fs.existsSync(p));
}

function formatarTelefone(telefoneExtraido) {
    let limpo = telefoneExtraido.replace(/\D/g, '');
    if (limpo.length >= 10 && !limpo.startsWith('55')) {
        limpo = '55' + limpo;
    }
    return limpo;
}

const URLS_BLACKLIST_SITE = [
    'ifood',
    'tripadvisor',
    'yelp',
    'guiamais',
    'cnpj',
    'casadosdados',
    'reclameaqui',
    'facebook',
    'instagram',
    'linkedin',
    'youtube',
    'tiktok',
    'linktr.ee'
];

function normalizarTexto(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function normalizarTelefoneParaValidacao(telefone) {
    return String(telefone || '').replace(/\D/g, '');
}

function extrairPalavrasPrincipais(nome) {
    const palavrasIgnoradas = new Set([
        'a', 'as', 'o', 'os', 'e', 'de', 'da', 'do', 'das', 'dos',
        'em', 'no', 'na', 'para', 'por', 'com', 'ltda', 'me', 'eireli'
    ]);

    return normalizarTexto(nome)
        .split(/[^a-z0-9]+/)
        .filter(palavra => palavra.length >= 3 && !palavrasIgnoradas.has(palavra));
}

function extrairCidadeDoEndereco(endereco) {
    const partesEndereco = String(endereco || '')
        .replace(/\s+/g, ' ')
        .split(',')
        .map(parte => parte.trim())
        .filter(Boolean);

    for (const parte of partesEndereco) {
        const correspondencia = parte.match(/^(.+?)\s*-\s*[A-Z]{2}$/i);
        if (correspondencia && correspondencia[1].trim()) {
            return correspondencia[1].trim();
        }
    }

    for (let indice = 1; indice < partesEndereco.length; indice++) {
        if (/^[A-Z]{2}$/i.test(partesEndereco[indice])) {
            const cidade = partesEndereco[indice - 1]
                .replace(/^.*-\s*/, '')
                .trim();
            if (cidade && !/\d/.test(cidade)) {
                return cidade;
            }
        }
    }

    return null;
}

function urlEstaNaBlacklist(url) {
    const urlNormalizada = normalizarTexto(url);
    return URLS_BLACKLIST_SITE.some(termo => urlNormalizada.includes(termo));
}

function obterUrlResultado(url) {
    try {
        const urlCompleta = new URL(url, 'https://duckduckgo.com');
        const urlRedirecionada = urlCompleta.searchParams.get('uddg');
        return urlRedirecionada ? decodeURIComponent(urlRedirecionada) : urlCompleta.href;
    } catch (erro) {
        return null;
    }
}

function extrairRedeSocial(url) {
    try {
        const urlValida = new URL(url);
        const hostname = urlValida.hostname.toLowerCase().replace(/^www\./, '');
        if (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) {
            return ['Instagram', urlValida.href];
        }
        if (hostname === 'facebook.com' || hostname.endsWith('.facebook.com')) {
            return ['Facebook', urlValida.href];
        }
    } catch (erro) {
        return null;
    }
    return null;
}

function redePertenceAoLead(url, textoResultado, lead) {
    return pontuarRedeSocial(url, textoResultado, lead) > 0;
}

function pontuarRedeSocial(url, textoResultado, lead) {
    let caminhoUrl = '';
    try {
        caminhoUrl = new URL(url).pathname;
    } catch (erro) {
        return 0;
    }

    const palavrasNome = extrairPalavrasPrincipais(lead.nome)
        .filter(palavra => palavra.length >= 4);
    const palavrasNicho = extrairPalavrasPrincipais(lead.nicho)
        .filter(palavra => palavra.length >= 4);
    const palavrasLocalizacao = extrairPalavrasPrincipais(lead.cidade)
        .filter(palavra => palavra.length >= 4);
    const palavrasContexto = new Set([...palavrasNicho, ...palavrasLocalizacao]);
    const palavrasSignificativas = palavrasNome.filter(palavra => !palavrasContexto.has(palavra));
    if (!palavrasSignificativas.length || (!palavrasNicho.length && !palavrasLocalizacao.length)) return 0;

    const textoUrl = normalizarTexto(caminhoUrl);
    const textoUrlCompacto = textoUrl.replace(/[^a-z0-9]/g, '');
    const textoTitulo = normalizarTexto(textoResultado);
    const textoPerfil = `${textoUrl} ${textoTitulo}`;
    const palavrasNaUrl = palavrasSignificativas.filter(palavra =>
        textoUrl.includes(palavra) || textoUrlCompacto.includes(palavra.replace(/[^a-z0-9]/g, ''))
    );
    const palavrasNoTitulo = palavrasSignificativas.filter(palavra => textoTitulo.includes(palavra));
    const palavrasNichoEncontradas = palavrasNicho.filter(palavra => textoPerfil.includes(palavra));
    const palavrasLocalizacaoEncontradas = palavrasLocalizacao.filter(palavra =>
        textoPerfil.includes(palavra)
    );
    const palavraNomeEncontrada = palavrasNaUrl.length > 0 || palavrasNoTitulo.length > 0;
    const palavraContextoEncontrada =
        palavrasNichoEncontradas.length > 0 || palavrasLocalizacaoEncontradas.length > 0;

    if (!palavraNomeEncontrada || !palavraContextoEncontrada) return 0;

    return (palavrasNaUrl.length * 5) + (palavrasNoTitulo.length * 2) +
        (palavrasNichoEncontradas.length * 3) +
        (palavrasLocalizacaoEncontradas.length * 2);
}

function filtrarRedesSociaisDoLead(redesSociais, lead) {
    if (!redesSociais || typeof redesSociais !== 'object' || !lead) {
        return {};
    }

    return Object.entries(redesSociais).reduce((redesValidas, [rede, url]) => {
        if (
            (rede === 'Instagram' || rede === 'Facebook') &&
            typeof url === 'string' &&
            redePertenceAoLead(url, '', lead)
        ) {
            redesValidas[rede] = url;
        }
        return redesValidas;
    }, {});
}

function siteFoiValidado(textoSite, lead) {
    return avaliarSiteCandidato(textoSite, lead).confirmado;
}

function avaliarSiteCandidato(textoSite, lead) {
    const textoNormalizado = normalizarTexto(textoSite);
    const telefoneLead = normalizarTelefoneParaValidacao(lead.telefone);
    const telefoneEncontrado = Boolean(
        telefoneLead && normalizarTelefoneParaValidacao(textoSite).includes(telefoneLead)
    );
    const cidade = normalizarTexto(lead.cidade).trim();
    const cidadeEncontrada = Boolean(cidade && textoNormalizado.includes(cidade));
    const palavrasNomeEncontradas = extrairPalavrasPrincipais(lead.nome)
        .filter(palavra => textoNormalizado.includes(palavra));

    return {
        confirmado: telefoneEncontrado || (cidadeEncontrada && palavrasNomeEncontradas.length > 0),
        telefoneEncontrado,
        cidadeEncontrada,
        palavrasNomeEncontradas
    };
}

async function buscarDadosFaltantes(lead, paginaPuppeteer) {
    const siteExistente = lead && typeof lead.site === 'string' && lead.site.trim()
        ? lead.site.trim()
        : null;
    const redesExistentes = lead?.redes_sociais && typeof lead.redes_sociais === 'object'
        ? Object.entries(lead.redes_sociais).reduce((redesValidas, [rede, url]) => {
            if (
                (rede === 'Instagram' || rede === 'Facebook') &&
                typeof url === 'string' &&
                url.trim()
            ) {
                redesValidas[rede] = url;
            }
            return redesValidas;
        }, {})
        : {};
    const precisaBuscarSite = !siteExistente;
    const precisaBuscarRedes = !redesExistentes.Instagram || !redesExistentes.Facebook;

    if (!lead || (!precisaBuscarSite && !precisaBuscarRedes)) {
        if (lead && !precisaBuscarSite && !precisaBuscarRedes) {
            console.log(`${c.cinza}ℹ️ Fallback não realizado para "${lead.nome}": site e redes sociais já cadastrados.${c.reset}`);
        }
        return {
            site: siteExistente,
            siteValidado: Boolean(siteExistente),
            redes_sociais: redesExistentes
        };
    }

    if (!lead.nome || !lead.cidade || !paginaPuppeteer) {
        console.log(`${c.amarelo}⚠️ Fallback ignorado: lead sem nome, cidade ou página disponível.${c.reset}`);
        return { site: null, siteValidado: false, redes_sociais: redesExistentes };
    }

    if (precisaBuscarSite) {
        console.log(`${c.ciano}🔄 Fallback iniciado para "${lead.nome}": buscando site e redes sociais faltantes.${c.reset}`);
    } else {
        console.log(`${c.ciano}🔄 Fallback iniciado para "${lead.nome}": buscando apenas redes sociais faltantes.${c.reset}`);
        console.log(`${c.cinza}   🌐 Busca de site não realizada: o Google Maps já informou um site.${c.reset}`);
    }

    let candidatosSite = [];
    let primeiraEvidenciaSite = null;
    const candidatosRedes = {};
    try {
        const consultas = [
            `${lead.nome} ${lead.cidade}`,
            `${lead.nome} Instagram`,
            `${lead.nome} Facebook`
        ];
        for (const consulta of consultas) {
            const urlBusca = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(consulta)}`;
            await paginaPuppeteer.goto(urlBusca, { waitUntil: 'domcontentloaded', timeout: 10000 });

            const resultados = await paginaPuppeteer.evaluate(() => Array.from(
                document.querySelectorAll('a[data-testid="result-title-a"], a.result__a')
            ).map(link => ({
                href: link.href,
                texto: link.innerText || ''
            })));
            for (const resultado of resultados) {
                const url = obterUrlResultado(resultado.href);
                if (!url) continue;

                const rede = extrairRedeSocial(url);
                if (rede && !redesExistentes[rede[0]]) {
                    const pontuacao = pontuarRedeSocial(url, resultado.texto, lead);
                    if (pontuacao > 0) {
                        const candidatosDaRede = candidatosRedes[rede[0]] || [];
                        if (!candidatosDaRede.some(candidato => candidato.url === rede[1])) {
                            candidatosDaRede.push({
                                url: rede[1],
                                pontuacao,
                                textoResultado: resultado.texto
                            });
                            candidatosRedes[rede[0]] = candidatosDaRede;
                        }
                    }
                }

                if (precisaBuscarSite && !urlEstaNaBlacklist(url) && !candidatosSite.includes(url)) {
                    candidatosSite.push(url);
                }
            }
        }

        for (const [rede, candidatosDaRede] of Object.entries(candidatosRedes)) {
            candidatosDaRede.sort((a, b) => b.pontuacao - a.pontuacao);
            if (candidatosDaRede[0]) {
                redesExistentes[rede] = candidatosDaRede[0].url;
            }
        }

        const redesEncontradas = Object.keys(redesExistentes);
        const resumoRedes = redesEncontradas.length
            ? redesEncontradas.join(', ')
            : 'nenhuma rede social válida';
        const resumoSite = precisaBuscarSite
            ? candidatosSite.length
                ? `${candidatosSite.length} candidato(s) encontrado(s)`
                : 'nenhum candidato encontrado'
            : 'não realizado (site já informado pelo Google Maps)';
        console.log(
            `${c.cinza}🔎 Busca complementar concluída para "${lead.nome}": ` +
            `site: ${resumoSite}; redes sociais: ${resumoRedes}.${c.reset}`
        );

        if (!precisaBuscarSite) {
            return {
                site: siteExistente,
                siteValidado: true,
                redes_sociais: redesExistentes
            };
        }

        for (const candidato of candidatosSite.slice(0, MAX_SITES_FALLBACK)) {
            try {
                console.log(`${c.cinza}🔎 Site candidato para "${lead.nome}": ${candidato}${c.reset}`);
                await paginaPuppeteer.goto(candidato, {
                    waitUntil: 'domcontentloaded',
                    timeout: 10000
                });
                const textoSite = await paginaPuppeteer.evaluate(() => document.body?.innerText || '');
                const evidencias = avaliarSiteCandidato(textoSite, lead);
                if (!primeiraEvidenciaSite) primeiraEvidenciaSite = evidencias;
                if (evidencias.confirmado) {
                    const siteCandidatoValidado = paginaPuppeteer.url();
                    console.log(`${c.verde}✅ Site candidato compatível com telefone ou cidade/nome; aguardando confirmação manual: ${siteCandidatoValidado}${c.reset}`);
                    return {
                        site: siteCandidatoValidado,
                        siteValidado: false,
                        evidencias,
                        redes_sociais: redesExistentes
                    };
                }
                console.log(`${c.amarelo}⚠️ Site encontrado, mas sem confirmação por telefone ou cidade/nome: ${candidato}${c.reset}`);
            } catch (erroSite) {
                console.log(`${c.amarelo}⚠️ Site candidato indisponível (${candidato}): ${erroSite.message}${c.reset}`);
            }
        }
    } catch (erroBusca) {
        console.log(`${c.amarelo}⚠️ Não foi possível buscar dados adicionais para "${lead.nome}": ${erroBusca.message}${c.reset}`);
        if (!precisaBuscarSite) {
            return {
                site: siteExistente,
                siteValidado: true,
                redes_sociais: redesExistentes
            };
        }
    }

    if (!precisaBuscarSite) {
        return {
            site: siteExistente,
            siteValidado: true,
            redes_sociais: redesExistentes
        };
    }

    const siteCandidato = candidatosSite[0] || null;
    if (siteCandidato) {
        console.log(`${c.amarelo}⚠️ Site candidato mantido para verificação manual: ${siteCandidato}${c.reset}`);
    }
    return {
        site: siteCandidato,
        siteValidado: false,
        evidencias: primeiraEvidenciaSite,
        redes_sociais: redesExistentes
    };
}

async function confirmarSite(lead, site, evidencias) {
    console.log(`\n${c.amarelo}${'─'.repeat(70)}${c.reset}`);
    console.log(`${c.amarelo}🌐 Site encontrado para verificação manual${c.reset}`);
    console.log(`${c.negrito}${site}${c.reset}`);
    if (evidencias) {
        const correspondencias = [];
        if (evidencias.telefoneEncontrado) correspondencias.push('telefone');
        if (evidencias.cidadeEncontrada) correspondencias.push('cidade');
        if (evidencias.palavrasNomeEncontradas.length) {
            correspondencias.push(`nome (${evidencias.palavrasNomeEncontradas.join(', ')})`);
        }
        console.log(`${c.cinza}🔎 Informações encontradas no site: ${correspondencias.length
            ? correspondencias.join(' | ')
            : 'nenhuma correspondência'}${c.reset}`);
    }
    console.log(`${c.amarelo}${'─'.repeat(70)}${c.reset}`);

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.log(`${c.amarelo}⚠️ Terminal sem entrada interativa; lead ignorado.${c.reset}`);
        return false;
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
    });

    try {
        while (true) {
            const resposta = (await rl.question(
                `${c.amarelo}O site "${site}" pertence a "${lead.nome}"? Salvar no banco? (y/n): ${c.reset}`
            )).trim().toLowerCase();

            if (resposta === 'y') return true;
            if (resposta === 'n') return false;

            console.log(`${c.amarelo}Digite apenas "y" para salvar ou "n" para ignorar.${c.reset}`);
        }
    } catch (erro) {
        console.log(`${c.amarelo}⚠️ Não foi possível confirmar o site manualmente; lead ignorado.${c.reset}`);
        return false;
    } finally {
        rl.close();
    }
}

function carregarLeadsExistentes() {
    if (fs.existsSync(CAMINHO_ARQUIVO)) {
        try {
            return JSON.parse(fs.readFileSync(CAMINHO_ARQUIVO, 'utf8'));
        } catch (e) {
            return [];
        }
    }
    return [];
}

function salvarNovoLead(novoLead, listaCompleta) {
    listaCompleta.push(novoLead);
    fs.writeFileSync(CAMINHO_ARQUIVO, JSON.stringify(listaCompleta, null, 2), 'utf8');
}

function exportarParaCRM(leads, assigned, leadsDaRonda = []) {
    const escaparCsv = (valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`;
    const telefonesDaRonda = new Set(leadsDaRonda.map(lead => lead.telefone));
    const nomeParaCRM = (lead) => lead.cidade
        ? `${lead.nome} - ${lead.cidade}`
        : lead.nome;

    const linhas = [
        CABECALHO_CSV_CRM.map(escaparCsv).join(',')
    ];

    for (const lead of leads) {
        const observacoesSite = lead.observacoes || (
            lead.site ? 'Possui site próprio.' : 'Não possui site próprio identificado.'
        );
        const notas = [
            lead.endereco && `Endereço: ${lead.endereco}`,
            lead.site && `Site: ${lead.site}`,
            lead.nicho && `Nicho: ${lead.nicho}`,
            lead.cidade && `Cidade: ${lead.cidade}`,
            `Possível Instagram: ${lead.redes_sociais?.Instagram || 'rede social não encontrada'}`,
            `Possível Facebook: ${lead.redes_sociais?.Facebook || 'rede social não encontrada'}`,
            `Observações: ${observacoesSite}`
        ].filter(Boolean).join('\n');

        const dados = [
            nomeParaCRM(lead),
            nomeParaCRM(lead),
            lead.telefone,
            lead.email,
            'Pipeline de Vendas',
            'Novo Lead',
            '0',
            'Google',
            telefonesDaRonda.has(lead.telefone) ? assigned : '',
            '',
            '',
            notas,
            '',
            'open',
            '',
            '',
            '',
            '',
            ''
        ];

        linhas.push(dados.map(escaparCsv).join(','));
    }

    fs.writeFileSync(CAMINHO_CSV_CRM, `${linhas.join('\r\n')}\r\n`, 'utf8');
}

// ==========================================
// 4. LOCALIZAÇÃO E RAIO
// ==========================================
function lerArgumentos() {
    const args = process.argv.slice(2);
    const resultado = {};
    for (let i = 0; i < args.length; i++) {
        if (!args[i].startsWith('--')) continue;
        const chave = args[i].slice(2);
        const proximo = args[i + 1];
        if (proximo === undefined || proximo.startsWith('--')) {
            resultado[chave] = true;
        } else {
            resultado[chave] = proximo;
            i++;
        }
    }
    return resultado;
}

async function perguntar(rl, texto, padrao) {
    const resposta = (await rl.question(`${texto} ${c.cinza}[${padrao}]${c.reset}: `)).trim();
    return resposta || String(padrao);
}

async function obterConfig() {
    const args = lerArgumentos();
    const configPadrao = carregarConfiguracao();

    if (args.ajuda || args.help) {
        mostrarAjuda();
        process.exit(0);
    }

    let local = args.local ?? configPadrao.local;
    let raio = args.raio ?? configPadrao.raio;
    let nichos = args.nichos ?? configPadrao.nichos.join(', ');
    let meta = args.meta ?? configPadrao.meta;
    let pontosBusca = args.pontos ?? configPadrao.pontos_busca ?? 7;
    let incluirComSite = args['incluir-com-site'] === undefined
        ? configPadrao.incluir_com_site
        : true;
    let assigned = args.assigned === undefined
        ? configPadrao.assigned
        : String(args.assigned);

    // Sem nenhum argumento e com terminal interativo: pergunta as opções
    const interativo = process.argv.length <= 2 && process.stdin.isTTY;
    if (interativo) {
        console.log(`${c.negrito}⚙️  Configuração da busca${c.reset} ${c.cinza}(Enter aceita o padrão)${c.reset}\n`);
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        local = await perguntar(rl, '📍 Localização (cidade, endereço ou "lat,lng"; vários com ";")', configPadrao.local);
        raio = await perguntar(rl, '📏 Raio de atuação em km', configPadrao.raio);
        nichos = await perguntar(rl, '🏷️  Nichos (separados por vírgula)', configPadrao.nichos.join(', '));
        meta = await perguntar(rl, '🎯 Meta de leads por busca', configPadrao.meta);
        pontosBusca = await perguntar(rl, '🧭 Centros de busca por local (1 a 7)', configPadrao.pontos_busca ?? 7);
        const incluirComSiteResposta = await perguntar(
            rl,
            '🌐 Incluir leads que possuem site? (y/n)',
            configPadrao.incluir_com_site ? 'y' : 'n'
        );
        incluirComSite = ['y', 'yes', 's', 'sim'].includes(
            incluirComSiteResposta.trim().toLowerCase()
        );
        assigned = await perguntar(
            rl,
            '👤 Responsável para o CRM',
            configPadrao.assigned
        );
        rl.close();
        console.log('');
    }

    const locais = String(local || configPadrao.local).split(';').map(s => s.trim()).filter(Boolean);
    const listaNichos = nichos && nichos !== true
        ? String(nichos).split(',').map(s => s.trim()).filter(Boolean)
        : configPadrao.nichos;

    let raioKm = parseFloat(String(raio).replace(',', '.'));
    if (!raioKm || raioKm <= 0) raioKm = configPadrao.raio;

    let metaPorBusca = parseInt(meta, 10);
    if (!metaPorBusca || metaPorBusca <= 0) metaPorBusca = configPadrao.meta;
    let quantidadePontos = parseInt(pontosBusca, 10);
    if (!Number.isInteger(quantidadePontos) || quantidadePontos < 1 || quantidadePontos > 7) {
        quantidadePontos = configPadrao.pontos_busca ?? 7;
    }

    return {
        locais,
        nichos: listaNichos,
        raioKm,
        meta: metaPorBusca,
        pontosBusca: quantidadePontos,
        headless: args.headless === undefined ? configPadrao.headless : !!args.headless,
        incluirComSite,
        assigned
    };
}

// Aceita "lat,lng" direto ou geocodifica o texto via OpenStreetMap (Nominatim)
async function geocodificar(local) {
    const coord = local.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coord) {
        return { nome: local, lat: parseFloat(coord[1]), lng: parseFloat(coord[2]) };
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(local)}`;
    const resposta = await fetch(url, {
        headers: { 'User-Agent': 'minerador-leads/1.0', 'Accept-Language': 'pt-BR' }
    });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

    const dados = await resposta.json();
    if (!dados.length) throw new Error('local não encontrado');

    return { nome: local, lat: parseFloat(dados[0].lat), lng: parseFloat(dados[0].lon) };
}

function distanciaKm(a, b) {
    const R = 6371;
    const rad = (g) => g * Math.PI / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

// Centro + seis pontos ao redor, para variar a ordenação local de resultados do Maps.
function gerarPontosBusca(local, raioKm, quantidade) {
    const pontos = [{ ...local, indice: 1 }];
    if (quantidade <= 1 || raioKm <= 0) return pontos;
    const deslocamentoKm = raioKm * 0.55;
    for (let i = 0; i < 6 && pontos.length < quantidade; i++) {
        const angulo = i * Math.PI / 3;
        const lat = local.lat + (deslocamentoKm * Math.cos(angulo)) / 111.32;
        const lng = local.lng + (deslocamentoKm * Math.sin(angulo)) /
            (111.32 * Math.cos(local.lat * Math.PI / 180));
        pontos.push({ nome: `${local.nome} - ponto ${pontos.length + 1}`, lat, lng, indice: pontos.length + 1 });
    }
    return pontos;
}

// Converte o raio em um nível de zoom do Google Maps (aproximado)
function zoomParaRaio(raioKm, lat) {
    const metrosPorPixelZoom0 = 156543.03392 * Math.cos(lat * Math.PI / 180);
    const zoom = Math.log2((metrosPorPixelZoom0 * 400) / (raioKm * 1000));
    return Math.max(8, Math.min(17, Math.floor(zoom)));
}

// Os links e URLs de lugares do Maps trazem as coordenadas como !3d{lat}!4d{lng}
function extrairCoordenadas(texto) {
    const m = (texto || '').match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
}

// ==========================================
// 5. RESUMO NO TERMINAL
// ==========================================
const estado = { novos: [], browser: null, totalBase: 0, encerrando: false };

function exibirResumo() {
    const novos = estado.novos;
    console.log(`\n${c.negrito}${'='.repeat(60)}${c.reset}`);
    console.log(`${c.negrito}📋 RESUMO DA EXECUÇÃO${c.reset}`);
    console.log(`${'='.repeat(60)}`);

    if (!novos.length) {
        console.log(`${c.amarelo}Nenhum lead novo encontrado nesta execução.${c.reset}`);
    } else {
        console.table(novos.map(l => ({
            Nome: l.nome,
            Telefone: l.telefone,
            Nicho: l.nicho,
            'Dist. (km)': l.distancia_km ?? '-',
            Local: l.cidade
        })));

        const porNicho = {};
        novos.forEach(l => { porNicho[l.nicho] = (porNicho[l.nicho] || 0) + 1; });
        console.log(`${c.negrito}Por nicho:${c.reset}`);
        Object.entries(porNicho).forEach(([nicho, qtd]) => console.log(`  • ${nicho}: ${qtd}`));
    }

    console.log(`\n${c.verde}${c.negrito}Novos leads: ${novos.length}${c.reset} | Total em leads.json: ${estado.totalBase}`);
    console.log(`📁 Arquivo: ${CAMINHO_ARQUIVO}`);
}

// Ctrl+C: mostra o que já foi capturado (os leads já estão salvos no arquivo)
process.on('SIGINT', async () => {
    if (estado.encerrando) process.exit(1);
    estado.encerrando = true;
    console.log(`\n${c.amarelo}⏹️  Interrompido pelo usuário.${c.reset}`);
    exibirResumo();
    await fecharNavegadorSeguro(estado.browser);
    process.exit(0);
});

// ==========================================
// 6. MOTOR DE MINERAÇÃO
// ==========================================
async function minerarLeads() {
    const config = await obterConfig();

    let todosLeads = carregarLeadsExistentes();
    estado.totalBase = todosLeads.length;
    exportarParaCRM(todosLeads);
    // Set com os telefones já salvos para nunca duplicar contatos
    const telefonesSalvos = new Set(todosLeads.map(lead => lead.telefone));

    console.log(`📂 Leads já cadastrados na base: ${todosLeads.length}`);
    console.log(`📏 Raio de atuação: ${config.raioKm} km`);
    console.log(`🧭 Centros de busca por local: ${config.pontosBusca}`);
    console.log(`🏷️  Nichos: ${config.nichos.length} | 🎯 Meta por busca: ${config.meta}\n`);

    // Localiza as coordenadas de cada ponto de busca
    const locais = [];
    for (const nome of config.locais) {
        try {
            const g = await geocodificar(nome);
            locais.push(g);
            console.log(`📍 ${nome} → ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}`);
        } catch (e) {
            console.log(`${c.vermelho}❌ Não foi possível localizar "${nome}": ${e.message}${c.reset}`);
        }
        await sleep(1100); // respeita o limite de 1 requisição/s do Nominatim
    }

    if (!locais.length) {
        console.log(`${c.vermelho}Nenhum local válido. Tente informar "lat,lng" direto em --local.${c.reset}`);
        return;
    }

    const executablePath = encontrarNavegador();
    console.log(`\n🌐 Navegador: ${executablePath || 'Chromium embutido do Puppeteer'}`);

    const launchOptions = {
        headless: config.headless,
        args: ['--disable-notifications', '--start-maximized', '--lang=pt-BR'],
        defaultViewport: null
    };

    if (executablePath) launchOptions.executablePath = executablePath;

    // --no-sandbox só é necessário no Linux (principalmente root/containers)
    if (process.platform === 'linux') {
        launchOptions.args.push('--no-sandbox', '--disable-setuid-sandbox');
    }

    const browser = await puppeteer.launch(launchOptions);
    estado.browser = browser;
    const page = await browser.newPage();
    const paginaFallback = await browser.newPage();
    await page.setCacheEnabled(false);
    await paginaFallback.setCacheEnabled(false);

    try {
        for (const local of locais) {
            const centro = { lat: local.lat, lng: local.lng };
            const pontosBusca = gerarPontosBusca(local, config.raioKm, config.pontosBusca);

            for (const nicho of config.nichos) {
              let leadsNesteNicho = 0;

              for (const ponto of pontosBusca) {
                if (leadsNesteNicho >= config.meta) break;

                const zoom = zoomParaRaio(config.raioKm, ponto.lat);
                console.log(`\n${c.ciano}${'='.repeat(60)}${c.reset}`);
                console.log(`${c.ciano}🔎 "${nicho}" | ponto ${ponto.indice}/${pontosBusca.length} de ${local.nome} (raio final ${config.raioKm} km)${c.reset}`);
                console.log(`${c.ciano}${'='.repeat(60)}${c.reset}`);

                const urlBusca = `https://www.google.com.br/maps/search/${encodeURIComponent(nicho)}/@${ponto.lat},${ponto.lng},${zoom}z?hl=pt-BR`;

                try {
                    await page.goto(urlBusca, { waitUntil: 'networkidle2', timeout: 60000 });
                    await sleep(4000);

                    let indexAtual = 0;
                    let tentativasSemNovosCards = 0;
                    let foraDoRaioSeguidos = 0;

                    while (leadsNesteNicho < config.meta) {
                        let cards = await page.$$('a[href*="/maps/place/"]');

                        if (indexAtual >= cards.length) {
                            console.log(`${c.cinza}📜 Rolando a lista para expandir resultados...${c.reset}`);
                            await page.evaluate(() => {
                                const feed = document.querySelector('div[role="feed"]');
                                if (feed) feed.scrollBy(0, 2000);
                            });
                            await sleep(3500);

                            let cardsAposScroll = await page.$$('a[href*="/maps/place/"]');
                            if (cardsAposScroll.length === cards.length) {
                                tentativasSemNovosCards++;
                                if (tentativasSemNovosCards >= 2) {
                                    console.log(`${c.amarelo}⚠️ Fim da lista para esta busca.${c.reset}`);
                                    break;
                                }
                            } else {
                                tentativasSemNovosCards = 0;
                            }
                            continue;
                        }

                        const card = cards[indexAtual];

                        try {
                            // Verificação de raio ANTES de abrir o card (economiza tempo)
                            const href = await card.evaluate(el => el.href);
                            let coords = extrairCoordenadas(href);
                            let distancia = coords ? distanciaKm(centro, coords) : null;

                            if (distancia !== null && distancia > config.raioKm) {
                                foraDoRaioSeguidos++;
                                console.log(`${c.cinza}📏 Fora do raio (${distancia.toFixed(1)} km), pulando...${c.reset}`);
                                indexAtual++;
                                if (foraDoRaioSeguidos >= MAX_FORA_DO_RAIO_SEGUIDOS) {
                                    console.log(`${c.amarelo}⚠️ Só há resultados fora do raio. Próxima busca.${c.reset}`);
                                    break;
                                }
                                continue;
                            }

                            await card.click();
                            await sleep(3200);

                            // Sem coordenadas no link? Tenta pela URL da página aberta
                            if (distancia === null) {
                                coords = extrairCoordenadas(page.url());
                                distancia = coords ? distanciaKm(centro, coords) : null;
                                if (distancia !== null && distancia > config.raioKm) {
                                    foraDoRaioSeguidos++;
                                    console.log(`${c.cinza}📏 Fora do raio (${distancia.toFixed(1)} km), pulando...${c.reset}`);
                                    indexAtual++;
                                    if (foraDoRaioSeguidos >= MAX_FORA_DO_RAIO_SEGUIDOS) {
                                        console.log(`${c.amarelo}⚠️ Só há resultados fora do raio. Próxima busca.${c.reset}`);
                                        break;
                                    }
                                    continue;
                                }
                            }
                            foraDoRaioSeguidos = 0;

                            const dadosEmpresa = await page.evaluate(() => {
                                const nomeEl = document.querySelector('h1.DUwDvf');
                                let nome = nomeEl ? nomeEl.innerText.trim() : null;

                                const siteEl = document.querySelector('a[data-item-id="authority"]');
                                const site = siteEl ? siteEl.href : null;

                                let telefone = null;
                                const btnTelefone = document.querySelector('button[data-item-id^="phone:tel:"]');
                                if (btnTelefone) {
                                    telefone = btnTelefone.getAttribute('data-item-id').replace('phone:tel:', '');
                                }

                                let endereco = null;
                                const btnEndereco = document.querySelector('button[data-item-id="address"]');
                                if (btnEndereco) {
                                    endereco = (btnEndereco.getAttribute('aria-label') || btnEndereco.innerText || '')
                                        .replace(/^Endere[cç]o:\s*/i, '')
                                        .trim();
                                }

                                const redesSociais = {};
                                const redes = [
                                    ['Instagram', /(^|\.)instagram\.com$/i],
                                    ['Facebook', /(^|\.)facebook\.com$/i],
                                    ['LinkedIn', /(^|\.)linkedin\.com$/i],
                                    ['TikTok', /(^|\.)tiktok\.com$/i],
                                    ['YouTube', /(^|\.)youtube\.com$/i]
                                ];

                                document.querySelectorAll('a[href]').forEach(link => {
                                    try {
                                        const url = new URL(link.href);
                                        const rede = redes.find(([, dominio]) => dominio.test(url.hostname));
                                        if (rede && !redesSociais[rede[0]]) {
                                            redesSociais[rede[0]] = url.href;
                                        }
                                    } catch (e) {
                                        // Ignora links que não sejam URLs válidas.
                                    }
                                });

                                return { nome, site, telefone, endereco, redesSociais };
                            });

                            if (!dadosEmpresa.nome) {
                                indexAtual++;
                                continue;
                            }

                            if (dadosEmpresa.telefone) {
                                const telefoneFormatado = formatarTelefone(dadosEmpresa.telefone);
                                if (telefonesSalvos.has(telefoneFormatado)) {
                                    console.log(`${c.amarelo}⏭️ Duplicado (já na lista): ${dadosEmpresa.nome}. Fallback não realizado.${c.reset}`);
                                    indexAtual++;
                                    continue;
                                }
                            }

                            dadosEmpresa.temSite = Boolean(dadosEmpresa.site);
                            if (!dadosEmpresa.temSite) {
                                dadosEmpresa.site = null;
                            }

                            const cidadeDaEmpresa = extrairCidadeDoEndereco(dadosEmpresa.endereco) || local.nome;
                            if (cidadeDaEmpresa !== local.nome) {
                                console.log(
                                    `${c.ciano}📍 Localidade atualizada pelo endereço: ${cidadeDaEmpresa}${c.reset}`
                                );
                            }

                            const dadosFaltantes = dadosEmpresa.temSite
                                ? {
                                    site: dadosEmpresa.site,
                                    siteValidado: true,
                                    redes_sociais: dadosEmpresa.redesSociais
                                }
                                : await buscarDadosFaltantes({
                                    nome: dadosEmpresa.nome,
                                    cidade: cidadeDaEmpresa,
                                    endereco: dadosEmpresa.endereco,
                                    nicho,
                                    telefone: dadosEmpresa.telefone,
                                    site: null,
                                    redes_sociais: dadosEmpresa.redesSociais
                                }, paginaFallback);
                            if (dadosEmpresa.temSite) {
                                console.log(`${c.cinza}ℹ️ Fallback não realizado para "${dadosEmpresa.nome}": site informado pelo Google Maps.${c.reset}`);
                            }
                            dadosEmpresa.site = dadosFaltantes.site;
                            dadosEmpresa.redesSociais = dadosFaltantes.redes_sociais;
                            const possuiSite = dadosEmpresa.temSite || Boolean(dadosEmpresa.site);
                            let siteAprovado = dadosEmpresa.temSite && config.incluirComSite;

                            if (dadosEmpresa.site && !dadosEmpresa.temSite) {
                                siteAprovado = await confirmarSite(
                                    { nome: dadosEmpresa.nome },
                                    dadosEmpresa.site,
                                    dadosFaltantes.evidencias
                                );
                            }

                            if ((!possuiSite || siteAprovado) && dadosEmpresa.telefone) {
                                const telefoneFormatado = formatarTelefone(dadosEmpresa.telefone);

                                if (telefonesSalvos.has(telefoneFormatado)) {
                                    console.log(`${c.amarelo}⏭️ Duplicado (já na lista): ${dadosEmpresa.nome}${c.reset}`);
                                } else {
                                    const siteParaSalvar = dadosEmpresa.temSite
                                        ? dadosEmpresa.site
                                        : null;
                                    const novoLead = {
                                        nome: dadosEmpresa.nome,
                                        telefone: telefoneFormatado,
                                        endereco: dadosEmpresa.endereco,
                                        site: siteParaSalvar,
                                        nicho: nicho,
                                        cidade: cidadeDaEmpresa,
                                        distancia_km: distancia !== null ? Number(distancia.toFixed(1)) : null,
                                        redes_sociais: dadosEmpresa.redesSociais,
                                        observacoes: dadosEmpresa.temSite
                                            ? 'Possui site próprio.'
                                            : dadosFaltantes.siteValidado
                                                ? 'Possui site próprio validado pelo fallback.'
                                                : 'Não possui site próprio identificado.',
                                        status: 'pendente'
                                    };

                                    salvarNovoLead(novoLead, todosLeads);
                                    estado.novos.push(novoLead);
                                    exportarParaCRM(todosLeads, config.assigned, estado.novos);
                                    estado.totalBase = todosLeads.length;
                                    telefonesSalvos.add(telefoneFormatado);
                                    leadsNesteNicho++;

                                    const distTxt = novoLead.distancia_km !== null ? ` | ${novoLead.distancia_km} km` : '';
                                    console.log(`${c.verde}✅ [${leadsNesteNicho}/${config.meta}] ${c.negrito}${novoLead.nome}${c.reset}${c.verde} | ${novoLead.telefone}${distTxt}${c.reset}`);
                                    if (novoLead.endereco) {
                                        console.log(`${c.cinza}   📍 ${novoLead.endereco}${c.reset}`);
                                    }
                                }
                            } else if (possuiSite && !siteAprovado) {
                                const tipoSite = dadosFaltantes.siteValidado
                                    ? 'confirmado'
                                    : 'candidato para verificação manual';
                                console.log(`${c.vermelho}❌ Ignorado (${tipoSite}): ${dadosEmpresa.nome}${c.reset}`);
                                console.log(`${c.cinza}   🌐 ${dadosEmpresa.site}${c.reset}`);
                            } else {
                                console.log(`${c.vermelho}❌ Ignorado (sem telefone): ${dadosEmpresa.nome}${c.reset}`);
                            }

                        } catch (error) {
                            console.log(`${c.amarelo}⚠️ Erro no card ${indexAtual}, pulando...${c.reset}`);
                        }

                        indexAtual++;
                    }

                } catch (erroNavegacao) {
                    console.log(`${c.vermelho}❌ Erro ao carregar a busca "${nicho}", pulando para a próxima...${c.reset}`);
                }
              }
            }
        }
    } finally {
        await fecharPaginaSegura(paginaFallback);
        await fecharPaginaSegura(page);
        await fecharNavegadorSeguro(browser);
        estado.browser = null;
    }

    console.log(`\n🎉 Varredura completa!`);
    exibirResumo();
}

if (require.main === module) {
    minerarLeads().catch(err => {
        console.error(`${c.vermelho}Erro fatal:${c.reset}`, err);
        process.exit(1);
    });
}

module.exports = {
    buscarDadosFaltantes,
    filtrarRedesSociaisDoLead,
    redePertenceAoLead,
    siteFoiValidado,
    extrairCidadeDoEndereco
};
