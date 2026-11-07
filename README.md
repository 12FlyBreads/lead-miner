# Minerador de Leads — Google Maps

Script em Node.js + Puppeteer que automatiza buscas no Google Maps e coleta **empresas que não possuem site, mas têm telefone cadastrado**, dentro de uma **localização e raio de atuação** que você define. O resultado é salvo em `leads.json` e exibido no terminal em tempo real e em uma tabela de resumo no final.

## Como funciona

1. Você informa uma **localização** (cidade, endereço ou coordenadas) e um **raio** em km.
2. O script converte o local em coordenadas (via OpenStreetMap/Nominatim) e abre o Google Maps centralizado ali, com zoom ajustado ao raio.
3. Para cada local e nicho, consulta até sete centros distribuídos pelo raio (o centro informado e seis pontos ao redor), para explorar listas que o Maps ordenaria de forma diferente em cada região.
4. Em cada centro, percorre os cards de resultados, rolando a lista para carregar mais. A deduplicação por telefone evita salvar novamente um comércio encontrado por mais de um ponto.
5. A distância de cada empresa até o centro original é calculada, e as que ficam **fora do raio são descartadas**.
6. Salva apenas empresas **sem site** e **com telefone**, ignorando duplicatas.
7. Cada lead aparece no terminal assim que é capturado e é gravado imediatamente no `leads.json` e no `leads_prontos_crm.csv`.
8. Opcionalmente, também busca e apresenta leads que possuem site para confirmação manual (`y/n`).
9. Ao final (ou com Ctrl+C), exibe uma tabela com os leads novos e a contagem por nicho.

A duplicidade é verificada assim que o telefone é coletado no Google Maps. Quando o
telefone já está em `leads.json`, o card é ignorado imediatamente: o fallback não é
executado e nenhuma confirmação manual de site é solicitada.

## Requisitos

- [Node.js](https://nodejs.org/) 18 ou superior (recomendado: versão LTS)
- Google Chrome ou Microsoft Edge instalado (opcional, veja abaixo)
- Windows, Linux ou macOS

## Instalação

1. Instale a versão LTS do Node.js pelo site oficial: <https://nodejs.org/>. O npm é instalado junto com o Node.js.
2. Feche e abra novamente o terminal e confirme a instalação:

```bash
node --version
npm --version
```

3. No terminal, entre na pasta do projeto (a pasta que contém `package.json`) e instale as dependências:

```bash
npm install
```

O `npm install` usa o `package.json` e o `package-lock.json` para instalar as dependências do projeto, incluindo o Puppeteer. O Puppeteer baixa o Chromium necessário; se você já tem Chrome ou Edge, o script tenta usá-los automaticamente.

No Windows, você pode abrir o PowerShell na pasta do projeto ou usar `cd` para chegar até ela antes de executar `npm install`.

## Uso

### Modo interativo

```bash
node minerar_leads.js
```

O script pergunta localização, raio, nichos e meta. Pressione Enter para aceitar o valor padrão de cada pergunta.
Esses valores são carregados de [`config.json`](./config.json), que pode ser editado antes da execução.

### Por argumentos

```bash
node minerar_leads.js --local "Pouso Alegre, MG" --raio 30
node minerar_leads.js --local "Itajuba, MG; Varginha, MG" --raio 15 --nichos "Pizzaria, Pet Shop" --meta 20
node minerar_leads.js --local "-22.4256,-45.4528" --raio 10 --headless
node minerar_leads.js --pontos 4
node minerar_leads.js --incluir-com-site
node minerar_leads.js --assigned "Nome do responsável"
```

| Opção | Descrição | Padrão |
|---|---|---|
| `--local` | Cidade, endereço ou `lat,lng`. Vários locais separados por `;` | `Itajuba, MG` |
| `--raio` | Raio de atuação em km a partir de cada local | `20` |
| `--nichos` | Segmentos separados por vírgula | lista no topo do script |
| `--meta` | Leads válidos por combinação nicho + ponto de busca | `15` |
| `--pontos` | Centros distribuídos pelo raio: 1 (só o centro) até 7 (centro + seis ao redor) | `7` |
| `--headless` | Executa sem abrir a janela do navegador | desligado |
| `--incluir-com-site` | Inclui leads com site e pede confirmação antes de salvar | desligado |
| `--assigned` | Responsável exportado no CSV do CRM nesta execução | valor do `config.json` |
| `--ajuda` | Mostra a ajuda | — |

Os valores padrão ficam em `config.json`. No modo interativo, o script pergunta no início de cada execução se deve incluir leads com site e qual responsável deve ser usado no CRM; pressione Enter para aceitar os padrões do arquivo. Os argumentos informados na linha de comando têm prioridade sobre o arquivo; por exemplo,
`--raio 30` altera o raio apenas naquela execução. A flag `--incluir-com-site` ativa essa opção diretamente, e `--assigned "Nome"` define o responsável somente para aquela execução. O campo `local` pode conter vários locais separados por `;` e `nichos` é uma lista JSON. Leads de execuções anteriores permanecem com o responsável vazio no CSV.

Exemplo de configuração:

```json
{
  "local": "Itajuba, MG",
  "raio": 20,
  "nichos": ["Pizzaria", "Pet Shop"],
  "meta": 15,
  "pontos_busca": 7,
  "headless": false,
  "incluir_com_site": false,
  "assigned": "Nome do responsável"
}
```

`incluir_com_site` fica desativado por padrão e preserva o comportamento de buscar
somente leads sem site. Quando definido como `true`, o Puppeteer coleta o site
informado no Google Maps (ou encontrado na busca de fallback), exibe a URL no
terminal e pergunta se o lead deve ser salvo:

```text
O site "https://exemplo.com" pertence a "Pizzaria Exemplo"? Salvar no banco? (y/n):
```

Responda `y` para adicionar o lead ou `n` para ignorá-lo. Essa confirmação exige
um terminal interativo.

### Escolhendo o navegador

A função `encontrarNavegador()` procura, nesta ordem:

1. A variável de ambiente `CHROME_PATH`
2. Chrome ou Edge nos caminhos padrão do sistema
3. O Chromium embutido do Puppeteer

Para forçar um caminho no PowerShell:

```powershell
$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
node minerar_leads.js
```

## Formato de saída

`leads.json` é uma lista de objetos:

```json
[
  {
    "nome": "Pizzaria Exemplo",
    "telefone": "5535999999999",
    "endereco": "Rua Exemplo, 123 - Centro, Itajubá - MG",
    "nicho": "Pizzaria",
    "cidade": "Itajuba, MG",
    "distancia_km": 4.2,
    "status": "pendente"
  }
]
```

- `telefone`: apenas dígitos, com prefixo `55` (formato aceito por links `wa.me`).
- `distancia_km`: distância até o centro da busca (pode ser `null` se o Maps não informar coordenadas).
- `status`: começa como `pendente`, para você controlar o andamento da prospecção.

Além do JSON, o arquivo `leads_prontos_crm.csv` é exportado ao final da execução, com as colunas necessárias para o import no CRM. Se a execução for interrompida com `Ctrl+C`, ele também é exportado antes do encerramento. Todos os campos são delimitados por aspas duplas; endereço, nicho, cidade, distância, redes sociais e observações ficam reunidos em `Notes`, cada tópico em uma nova linha. São identificadas redes do Instagram, Facebook, LinkedIn, TikTok e YouTube quando o Google Maps disponibilizar os links; essas informações do Maps são aceitas sem validação. Redes encontradas no fallback do buscador só são salvas quando o perfil contém uma palavra distintiva do nome da empresa e também uma palavra do nicho ou da localização; resultados sem essas duas evidências são ignorados para evitar associar o perfil de outra empresa.
Quando há mais de um perfil possível para a mesma rede, o fallback prioriza o candidato com maior pontuação de correspondência no endereço e no título do resultado.

Sites encontrados pelo fallback são sempre tratados como candidatos e exigem confirmação manual, mesmo quando o telefone, a cidade ou o nome parecem compatíveis. A validação automática serve apenas para priorizar o candidato e não autoriza seu salvamento. Se o candidato for aceito manualmente, o lead é salvo, mas a URL candidata não é gravada no campo `site` do `leads.json`, pois ela não foi confirmada como site da empresa. Sites informados diretamente pelo Google Maps são aceitos sem validação: quando `incluir_com_site` está ativo, são salvos; quando está desativado, o lead é ignorado. Links do Maps que apontam para redes sociais, WhatsApp ou agregadores como Linktree são tratados como ausência de site próprio e acionam o fallback normalmente. Para os demais domínios, a presença de um site no Maps impede a execução do fallback. As `Notes` do CRM sempre incluem as linhas de Instagram e Facebook; quando uma rede não é encontrada, o valor fica como `rede social não encontrada`.

Antes da confirmação manual de um site do fallback, o terminal informa quais evidências foram encontradas no conteúdo: telefone, cidade e palavras identificadas do nome da empresa. Se nenhuma correspondência for encontrada, isso também é exibido para orientar a decisão.

As páginas do Google Maps e do fallback usam o cache HTTP do Chromium desativado. Os resultados do fallback são coletados novamente para cada lead e não são reutilizados entre empresas.

O fallback faz três consultas por lead, sem aspas para evitar restringir os resultados: `nome da empresa + cidade`, `nome da empresa Instagram` e `nome da empresa Facebook`. Todos os resultados de cada consulta são analisados para redes sociais e candidatos de site; no máximo os cinco primeiros candidatos de site são abertos para validação. Para uma rede social ser aceita, o perfil precisa conter uma palavra significativa do nome da empresa e uma palavra do nicho ou da localização, no endereço do perfil ou no título do resultado.

`leads.json`, `leads.csv` e `leads_prontos_crm.csv` são arquivos locais gerados durante a execução e não são enviados ao Git.

Para apagar os leads atuais e manter apenas a estrutura vazia dos arquivos:

```bash
node limpar_leads.js
```

Esse comando redefine `leads.json` para `[]` e mantém somente o cabeçalho em `leads_prontos_crm.csv`.

Se o arquivo já existir, o script o carrega e **não duplica** telefones já salvos, então é seguro rodar várias vezes. Leads antigos, sem `endereco` e `distancia_km`, continuam válidos.

## Solução de problemas

- **Local não encontrado:** informe as coordenadas direto em `--local "lat,lng"` (clique com o botão direito no Google Maps para copiá-las).
- **Navegador não abre:** defina `CHROME_PATH` com o caminho do executável.
- **Nenhum lead capturado:** o Google Maps muda seus seletores CSS com frequência. Se isso acontecer, revise `h1.DUwDvf`, `a[data-item-id="authority"]` e `button[data-item-id^="phone:tel:"]`.
- **Poucos resultados com raio pequeno:** o Maps limita quantos resultados mostra por busca. Aumente o raio ou use mais nichos.
- **Cobertura espacial:** `pontos_busca` (ou `--pontos`) altera o número de centros consultados. O padrão 7 inclui o centro e seis pontos a 55% do raio ao redor; diminua para reduzir o tempo. A meta é aplicada por nicho dentro de cada local, acumulando os leads encontrados nos diferentes centros.
- **Emojis quebrados no terminal do Windows:** use o Windows Terminal ou rode `chcp 65001` antes do script.
- **Busca travando:** aumente os valores de `sleep()` em conexões lentas.

## Observações

- O raio é aplicado em linha reta, pela distância entre as coordenadas da empresa e o centro, não por tempo de deslocamento.
- O telefone coletado pode ser fixo e não ter WhatsApp. Vale validar antes do contato.
- Automatizar o Google Maps pode violar os termos de uso da plataforma, e o uso dos dados deve respeitar a **LGPD**. Use com moderação e com abordagem comercial responsável.
