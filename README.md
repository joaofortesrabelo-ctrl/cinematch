# 🎬 CineMatch — Recomendador de Filmes e Séries

Aplicação web que sugere **3 filmes ou séries** de acordo com o gênero favorito, o humor do momento, o tempo disponível e a faixa etária de quem vai assistir.

Feita com **HTML5, CSS3 e JavaScript puro**, sem bibliotecas. Os dados ficam no **LocalStorage**.

---

> ⚠️ **Antes de abrir:** extraia o zip (botão direito → *Extrair tudo…*) e abra o `index.html` da pasta extraída. Abrir o `index.html` de dentro do zip carrega a página sem o CSS e o JavaScript.

## ▶️ Como rodar

1. Baixe/descompacte a pasta `cinematch/`.
2. Abra o arquivo `index.html` no navegador (Chrome, Edge, Firefox…).

Não precisa instalar nada nem rodar servidor.

> **API do TMDb (opcional / bônus):** clique em **?** → *Configurar API TMDb* (ou na tela **Explorar**) e cole sua chave gratuita de <https://www.themoviedb.org/settings/api>. Com a chave aparecem pôsteres reais, sinopses e uma busca online. Sem chave, tudo funciona com o catálogo local.

---

## 📁 Estrutura

```
cinematch/
├── index.html        → estrutura semântica (header, nav, main, section, form, dialog, footer)
├── css/
│   └── style.css     → tema claro/escuro com variáveis CSS, componentes, animações, responsividade
├── js/
│   ├── app.js        → recomendação, telas, eventos, tema, perfis, API TMDb
│   ├── movies.js     → catálogo (56 títulos: 35 filmes + 21 séries), gêneros, humores, tempos, faixas
│   ├── storage.js    → toda a leitura/escrita no LocalStorage (por perfil)
│   └── testes.js     → 40 testes automáticos do sistema de recomendação
├── testes.html       → abra no navegador para rodar os testes (✅/❌)
└── assets/
    └── images/       → (os pôsteres são gerados por CSS; com a API vêm do TMDb)
```

---

## ✅ Requisitos funcionais

| Requisito | Onde está |
|---|---|
| RF01 – Selecionar preferências | Formulário em **Recomendar**: tipo, gêneros, humor, tempo e faixa etária, com validação |
| RF02 – Gerar recomendações | Botão **Recomendar** → 3 sugestões com % de match e o motivo de cada uma |
| RF03 – Adicionar favoritos | Botão **🤍 Favoritar** em qualquer card ou nos detalhes |
| RF04 – Remover favoritos | Clicar de novo no ❤️, ou **🗑️ Remover** na tela Favoritos (com **Desfazer**) |
| RF05 – Visualizar histórico | Tela **Histórico**: últimas 30 recomendações com data, preferências e títulos |
| RF06 – Salvar dados localmente | `storage.js`: favoritos, histórico, preferências, tema, perfis e cache da API |

### Como a recomendação funciona (`app.js`, seção 3)

1. **Filtros obrigatórios:** classificação indicativa ≤ faixa etária escolhida e tipo (filme/série).
2. **Pontuação** de cada título:
   - +30 por gênero em comum
   - +25 se combina com o humor
   - nota do público × 4
   - −60 se não cabe no tempo (−12 se passa até 15 min)
   - um pequeno fator aleatório para variar as sugestões
3. Ficam os 3 melhores. **Outras sugestões** não repete os que já apareceram e **🔄 Trocar** troca só um card.

### 👥 Modo "Assistir junto" (`app.js`, seção 3.1)

Duas pessoas escolhem gêneros, humor e faixa etária; o tipo e o tempo são escolhidos juntos.

1. **Faixa etária:** vale a de quem é mais novo.
2. Cada título é pontuado **duas vezes** com a mesma função `pontuar()`, uma para cada pessoa.
3. **Pontos do par = a menor das duas pontuações** (empate: maior soma). Assim, um título que só uma pessoa ama não passa na frente de um que as duas curtem.
4. Primeiro entram os títulos que agradam as duas, depois os que agradam uma ("Agrada mais a…") e, por último, os mais bem avaliados.

Cada card mostra uma barrinha com a % de cada pessoa e motivos escritos para o par ("Os dois curtem Comédia", "Ana curte Animação").

---

## ⭐ Diferenciais (critério "Criatividade" e bônus)

- **Integração com a API do TMDb**: pôsteres reais, sinopses em português e busca online, com cache.
- **Sistema de busca** (tela Explorar): busca sem acento, filtro por gênero e tipo, 4 ordenações.
- **Avaliação por estrelas**: o usuário dá de 1 a 5 ★ aos favoritos.
- **Estatísticas dos favoritos**: gêneros favoritos, humores mais pedidos, gráfico filmes × séries, nota média, tempo para maratonar e título destaque.
- **👥 Assistir junto**: recomendação para duas pessoas, com a compatibilidade de cada uma.
- **Perfis de usuário**: cada perfil tem os próprios favoritos, histórico e preferências.
- **Backup**: exportar e importar os favoritos em JSON.
- **"Por que recomendamos"**: cada card explica o motivo da sugestão e mostra a % de match.
- **🎲 Surpreenda-me**, **📋 Copiar dica** e **📍 Onde assistir**.
- **Animações**: entrada dos cards, esqueleto de carregamento, coração "pulsando", notificações e gráficos que crescem. Tudo respeita `prefers-reduced-motion`.
- **Atalhos de teclado**: `1`–`5` (telas), `J` (Assistir junto), `T` (tema), `/` (busca), `?` (ajuda).

---

## 🧠 Heurísticas de Nielsen aplicadas

| # | Heurística | Como foi aplicada |
|---|---|---|
| 1 | Visibilidade do status do sistema | Botão "Procurando…" com spinner, esqueleto dos cards, indicador de etapas (1-2-3), item ativo destacado no menu, contador de favoritos, notificações após cada ação |
| 2 | Correspondência com o mundo real | Linguagem do dia a dia ("Quero rir", "Tenho a noite toda"), emojis, classificação indicativa com as cores oficiais brasileiras |
| 3 | Controle e liberdade do usuário | **Desfazer** ao remover favorito ou histórico, trocar uma sugestão, limpar escolhas, fechar modais com Esc ou clicando fora |
| 4 | Consistência e padrões | Mesmo card, botões e cores em todas as telas; ❤️ sempre significa favorito; mesmo layout de cabeçalho em todas as seções |
| 5 | Prevenção de erros | Validação antes de recomendar, campos obrigatórios marcados com *, confirmação antes de limpar o histórico, excluir perfil ou restaurar backup |
| 6 | Reconhecer em vez de lembrar | Preferências ficam salvas e o formulário volta preenchido; o histórico mostra as preferências usadas e tem **"Usar estas preferências"** |
| 7 | Flexibilidade e eficiência | Atalhos de teclado, 🎲 Surpreenda-me, "Outras sugestões" com 1 clique, ordenação e filtros |
| 8 | Estética e design minimalista | Uma ação principal por tela, hierarquia visual clara, tema claro/escuro |
| 9 | Ajudar a reconhecer e corrigir erros | Mensagens de erro claras ao lado do campo, com ícone e foco automático no primeiro erro; aviso quando um título passa do tempo |
| 10 | Ajuda e documentação | Botão **?** com o passo a passo e os atalhos; dicas abaixo dos campos |

---

## ♿ Acessibilidade e HTML semântico

**Auditoria com axe-core 4.14 (padrão WCAG 2.2 AA): 0 violações** em 54 verificações, cobrindo as 5 telas, 4 janelas e o formulário com erros, nos temas claro e escuro, em 1366, 390 e 320 px.

- Contraste de pelo menos 4.5:1 em todos os textos (as notas ⭐ e o botão de favorito ganharam tons mais escuros no tema claro).
- O título de cada card é o botão de detalhes; o leitor de tela ouve também a compatibilidade, o tipo e a classificação indicativa.
- Os atalhos de uma tecla podem ser desligados na janela de Ajuda (WCAG 2.1.4).
- As notificações param de contar enquanto o mouse ou o foco do teclado estão sobre elas (WCAG 2.2.1); os erros são anunciados na hora (`role="alert"`).
- Títulos em ordem (h1 → h2 → h3) e suporte ao modo de alto contraste do Windows.

- Tags semânticas: `header`, `nav`, `main`, `section`, `article`, `aside`, `footer`, `form`, `fieldset/legend`, `dialog`, `ol/ul/dl`.
- Link "Pular para o conteúdo", `aria-current` no menu, `aria-pressed` nos botões de alternar, `aria-live` nos resultados e notificações.
- Foco visível em todos os elementos, navegação completa por teclado e foco devolvido ao fechar modais.
- Contraste adequado nos dois temas.

## 📱 Responsividade

- **Desktop (> 1024px):** menu completo no topo e 3 cards lado a lado.
- **Tablet (601–1024px):** menu mais compacto. A partir de 860px o menu vai para uma **barra inferior** (estilo app) e os cards ficam em 2 colunas.
- **Celular (≤ 600px):** formulário em 1 coluna, cards horizontais (pôster à esquerda), modais em tela cheia.

## 💾 Chaves no LocalStorage

`cinematch:tema` · `cinematch:perfis` · `cinematch:perfilAtivo` · `cinematch:<perfil>:favoritos` · `cinematch:<perfil>:historico` · `cinematch:<perfil>:prefs` · `cinematch:<perfil>:juntos` · `cinematch:tmdbKey` · `cinematch:tmdbCache`

---

*As notas são médias aproximadas do público. As sinopses do catálogo local foram escritas para o projeto.*

---

## 🔧 Revisão de código (25/11/2026)

Bugs encontrados com testes de casos-limite e corrigidos:

| Bug | Correção |
|---|---|
| Clique duplo em "Outras sugestões" gerava duas buscas e duplicava o histórico | Só uma busca roda por vez; os botões ficam desativados durante o carregamento |
| Trocar de perfil durante a busca salvava o histórico no perfil errado | O resultado é descartado se o perfil mudou no meio |
| "Limpar escolhas" voltava ao recarregar a página (as preferências continuavam salvas e o navegador restaurava os campos) | Limpar apaga as preferências salvas; o formulário tem `autocomplete="off"` e é sempre preenchido a partir do que está salvo |
| Backup com título inexistente deixava o contador de favoritos errado | O contador só conta títulos que existem no catálogo |
| Backup com itens inválidos (nulos, notas fora de 1–5, histórico quebrado) travava as telas | `limparBackup()` valida tudo antes de importar e informa quantos itens foram ignorados; o `storage.js` também filtra dados malformados |

**Encontrado no teste do aluno (25/11/2026):** preferências salvas por uma versão antiga do app, ou dados estragados no navegador, faziam a inicialização parar antes de ligar os eventos. O formulário aparecia, mas "Recomendar" e as abas não respondiam. Agora:
- o app confere tudo o que está salvo antes de usar (`prefsSalvas()`, `juntosSalvos()`, `historicoValido()`) e ignora o que for inválido;
- os eventos são ligados logo depois de montar o formulário, e cada etapa da inicialização roda protegida (`etapaSegura()`), então um erro em uma etapa não trava as outras.

Melhorias: aviso explicando quando há menos de 3 títulos possíveis; o botão de favorito guarda se é compacto num atributo (antes era deduzido pelo texto); comentário duplicado removido.

---

## 🧪 Testes automáticos

Abra **`testes.html`** no navegador: 40 testes rodam na hora, sem instalar nada, e cada um aparece com ✅ ou ❌.

| Grupo | O que verifica |
|---|---|
| Filtros obrigatórios | Classificação indicativa e tipo respeitados em 500 combinações aleatórias; lista de exclusão |
| Pontuação | +30 por gênero, +25 por humor, nota × 4, −60 / −12 pelo tempo, episódio nas séries, sorteio ≤ 10, % entre 35 e 99 |
| Exemplo do relatório | De Volta para o Futuro 119 pts / 99%, Star Wars 107,4 / 93%, Interestelar fora |
| Escolha dos 3 melhores | Máximo 3 sem repetir, ordem por pontos, sempre 3 com "Tanto faz", aviso quando completa, motivo em todos |
| Outras sugestões e Trocar | Rodadas sem repetição até esgotar, Trocar traz título novo |
| Validação e apoio | Erros do formulário, formatarDuracao, normalizar, limparBackup e consistência do catálogo |
| Assistir junto | Faixa de quem é mais novo e tipo (500 combinações), pontos = menor das duas, ordem pela pessoa menos satisfeita, preferência pelo que agrada os dois, ordem das pessoas não importa, gostos opostos, nomes nos motivos, validação e backup |

**Os testes pegam erro de verdade:** 4 bugs foram colocados de propósito numa cópia do app (tirar o filtro de faixa etária, trocar +30 por +20, tirar a tolerância de 15 min e ignorar a lista de exclusão). Cada um fez de 2 a 4 testes falharem.

No modo **Assistir junto**, mais 3 bugs de propósito: usar a maior pontuação em vez da menor, usar a faixa de quem é mais velho e não dar preferência ao que agrada os dois. O primeiro **não foi pego** na primeira versão dos testes, porque o título usado tinha a mesma nota para as duas pessoas. O teste foi trocado por um título em que elas discordam (Toy Story: Ana 98%, Pedro 81%) e ganhou um teste de ordem; agora os 3 bugs são pegos.

