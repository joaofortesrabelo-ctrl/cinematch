/**
 * app.js — Lógica principal do CineMatch
 * ----------------------------------------------------------------
 * Depende de: movies.js (dados) e storage.js (LocalStorage).
 *
 * Seções deste arquivo:
 *   1. Utilidades
 *   2. Estado da aplicação
 *   3. Sistema de recomendação
 *   4. Componentes de interface (cards, toasts, confirmação)
 *   5. Telas: Recomendar · Assistir junto · Explorar · Favoritos · Histórico · Estatísticas
 *   6. Tema, perfis e ajuda
 *   7. Integração com a API do TMDb (bônus)
 *   8. Navegação, atalhos e eventos
 *   9. Inicialização
 */

/* ================================================================
   1. UTILIDADES
   ================================================================ */
const $ = (seletor, ctx = document) => ctx.querySelector(seletor);
const $$ = (seletor, ctx = document) => [...ctx.querySelectorAll(seletor)];
const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Escapa texto antes de colocar em HTML (evita quebrar a página / XSS). */
const esc = texto => String(texto ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** 169 → "2h49min" · 45 → "45min" · 120 → "2h" */
function formatarDuracao(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h${String(m).padStart(2, '0')}min` : `${h}h`;
}

const duracaoTexto = t => (t.tipo === 'serie' ? `${formatarDuracao(t.duracao)}/ep` : formatarDuracao(t.duracao));
const tipoTexto = t => (t.tipo === 'serie' ? '📺 Série' : '🎬 Filme');
const classifTexto = n => (n === 0 ? 'L' : String(n));
const buscarTitulo = id => CATALOGO.find(t => t.id === id);
const infoGenero = id => GENEROS.find(g => g.id === id) || GENEROS[0];
const infoHumor = id => HUMORES.find(h => h.id === id);
const infoTempo = id => TEMPOS.find(t => t.id === id);
const infoFaixa = id => FAIXAS.find(f => f.id === id);

/** Remove acentos e deixa minúsculo — para a busca achar "acao" em "Ação". */
const normalizar = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function embaralhar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function debounce(fn, ms = 250) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function formatarData(iso) {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoje.toDateString()) return `Hoje, ${hora}`;
  if (d.toDateString() === ontem.toDateString()) return `Ontem, ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}, ${hora}`;
}

/* ================================================================
   2. ESTADO DA APLICAÇÃO
   ================================================================ */
const estado = {
  view: 'recomendar',
  prefsAtuais: null,   // preferências da recomendação em tela
  resultados: [],      // [{ titulo, pct, motivos, cabe }]
  jaMostrados: [],     // ids já sugeridos nesta rodada (para "Outras sugestões")
  ultimoFoco: null,    // elemento que abriu um modal (para devolver o foco)
  carregando: false,   // true enquanto uma recomendação está sendo gerada (evita cliques duplos)
  juntos: { prefs: null, resultados: [], jaMostrados: [] } // mesmo controle, para o modo "Assistir junto"
};

/* ================================================================
   3. SISTEMA DE RECOMENDAÇÃO
   ----------------------------------------------------------------
   1) Filtros obrigatórios: classificação indicativa e tipo.
   2) Pontuação de cada candidato:
        + 30 por gênero em comum
        + 25 se combina com o humor
        + nota do público × 4
        − 60 se não cabe no tempo disponível (− 12 se passa até 15 min)
        + pequeno fator aleatório (para variar as sugestões)
   3) Ficam os 3 melhores. Se faltar, completa com os mais bem avaliados.
   ================================================================ */
function pontuar(t, prefs) {
  const tempo = infoTempo(prefs.tempo);
  const generosEmComum = t.generos.filter(g => prefs.generos.includes(g));
  const combinaHumor = t.humores.includes(prefs.humor);
  const cabe = t.duracao <= tempo.max;
  const passaPouco = !cabe && t.duracao <= tempo.max + 15; // tolerância de 15 min

  let pontos = generosEmComum.length * 30 + (combinaHumor ? 25 : 0) + t.nota * 4 + Math.random() * 10;
  if (!cabe) pontos -= passaPouco ? 12 : 60;

  // "% de match" exibido no card (só para o usuário entender a afinidade)
  const proporcaoGeneros = generosEmComum.length / Math.min(prefs.generos.length, t.generos.length);
  const pct = Math.round(Math.max(35, Math.min(99,
    38 + proporcaoGeneros * 34 + (combinaHumor ? 16 : 0) + (cabe ? 6 : passaPouco ? 0 : -10) + (t.nota - 7) * 3
  )));

  const motivos = [];
  if (generosEmComum.length) motivos.push({ icone: '🎯', texto: `Combina com ${generosEmComum.join(' e ')}` });
  if (combinaHumor) {
    const h = infoHumor(prefs.humor);
    motivos.push({ icone: h.emoji, texto: `Ótimo para o humor “${h.label}”` });
  }
  if (cabe && tempo.max !== Infinity) {
    motivos.push({ icone: '⏱️', texto: t.tipo === 'serie' ? 'Episódios cabem no seu tempo' : `Cabe no seu tempo (${formatarDuracao(t.duracao)})` });
  } else if (passaPouco) {
    motivos.push({ icone: '⏱️', texto: `Passa só um pouquinho do seu tempo (${formatarDuracao(t.duracao)})` });
  } else if (!cabe) {
    motivos.push({ icone: '⚠️', texto: `Passa do seu tempo (${formatarDuracao(t.duracao)})`, aviso: true });
  }
  if (t.nota >= 8.8) motivos.push({ icone: '🏆', texto: 'Um dos mais bem avaliados' });

  return { titulo: t, pontos, pct, motivos, relevante: generosEmComum.length > 0 || combinaHumor, cabe };
}

function recomendar(prefs, excluir = [], quantidade = 3) {
  const faixa = infoFaixa(prefs.faixa);
  const candidatos = CATALOGO.filter(t =>
    t.classificacao <= faixa.max &&
    (prefs.tipo === 'todos' || t.tipo === prefs.tipo) &&
    !excluir.includes(t.id)
  );

  const pontuados = candidatos.map(t => pontuar(t, prefs)).sort((a, b) => b.pontos - a.pontos);
  const relevantes = pontuados.filter(p => p.relevante);
  const escolhidos = relevantes.slice(0, quantidade);

  // Completa com os mais bem avaliados se não houver títulos suficientes
  if (escolhidos.length < quantidade) {
    pontuados
      .filter(p => !escolhidos.includes(p))
      .sort((a, b) => b.titulo.nota - a.titulo.nota)
      .slice(0, quantidade - escolhidos.length)
      .forEach(p => {
        p.motivos.unshift({ icone: '⭐', texto: 'Sugestão bem avaliada pelo público' });
        escolhidos.push(p);
      });
  }
  return escolhidos;
}

/** Quantos títulos ainda podem ser sugeridos para essas preferências. */
function totalDisponivel(prefs) {
  const faixa = infoFaixa(prefs.faixa);
  return CATALOGO.filter(t => t.classificacao <= faixa.max && (prefs.tipo === 'todos' || t.tipo === prefs.tipo)).length;
}

/* ----------------------------------------------------------------
   3.1 MODO "ASSISTIR JUNTO"
   ----------------------------------------------------------------
   Cada pessoa escolhe gêneros, humor e faixa etária.
   O tipo (filme/série) e o tempo são escolhidos juntos, porque o par
   vai assistir a mesma coisa no mesmo horário.
   1) Faixa etária: vale a mais restritiva (a de quem é mais novo).
   2) Cada título é pontuado duas vezes com a MESMA função pontuar(),
      uma com as preferências de cada pessoa.
   3) Pontos do par = a MENOR das duas pontuações. Assim, um título
      que uma pessoa ama e a outra odeia não ganha de um que as duas
      curtem. Empate: vence a maior soma.
   4) Entram primeiro os títulos que agradam as duas; se faltar, os que
      agradam uma delas; por último, os mais bem avaliados.
   ---------------------------------------------------------------- */
const nomeDaPessoa = (p, n) => (p.nome || '').trim() || `Pessoa ${n}`;

/** Preferências de uma pessoa no formato que pontuar() já entende. */
const prefsDaPessoa = (p, comum) => ({ tipo: comum.tipo, generos: p.generos, humor: p.humor, tempo: comum.tempo, faixa: p.faixa });

/** A faixa etária mais restritiva entre as duas pessoas. */
const faixaDoPar = j => (infoFaixa(j.a.faixa).max <= infoFaixa(j.b.faixa).max ? j.a.faixa : j.b.faixa);

function pontuarJuntos(t, j) {
  const nA = nomeDaPessoa(j.a, 1), nB = nomeDaPessoa(j.b, 2);
  const pa = pontuar(t, prefsDaPessoa(j.a, j.comum));
  const pb = pontuar(t, prefsDaPessoa(j.b, j.comum));

  // Motivos pensados para o par
  const gA = t.generos.filter(g => j.a.generos.includes(g));
  const gB = t.generos.filter(g => j.b.generos.includes(g));
  const dosDois = gA.filter(g => gB.includes(g));
  const soA = gA.filter(g => !dosDois.includes(g));
  const soB = gB.filter(g => !dosDois.includes(g));
  const humorA = t.humores.includes(j.a.humor), humorB = t.humores.includes(j.b.humor);

  const motivos = [];
  if (dosDois.length) motivos.push({ icone: '💞', texto: `Os dois curtem ${dosDois.join(' e ')}` });
  if (soA.length) motivos.push({ icone: '🎯', texto: `${nA} curte ${soA.join(' e ')}` });
  if (soB.length) motivos.push({ icone: '🎯', texto: `${nB} curte ${soB.join(' e ')}` });
  if (humorA && humorB && j.a.humor === j.b.humor) {
    const h = infoHumor(j.a.humor);
    motivos.push({ icone: h.emoji, texto: `Ótimo para o humor “${h.label}” dos dois` });
  } else if (humorA && humorB) {
    motivos.push({ icone: '😊', texto: `Combina com o humor de ${nA} e de ${nB}` });
  } else if (humorA || humorB) {
    const [quem, p] = humorA ? [nA, j.a] : [nB, j.b];
    const h = infoHumor(p.humor);
    motivos.push({ icone: h.emoji, texto: `Combina com o humor de ${quem} (“${h.label}”)` });
  }
  const tempo = pa.motivos.find(m => m.icone === '⏱️' || m.icone === '⚠️');
  if (tempo) motivos.push({ ...tempo, texto: tempo.texto.replace('seu tempo', 'tempo de vocês') });
  if (t.nota >= 8.8) motivos.push({ icone: '🏆', texto: 'Um dos mais bem avaliados' });
  if (pa.relevante !== pb.relevante) motivos.push({ icone: '⚖️', texto: `Agrada mais a ${pa.relevante ? nA : nB}` });

  return {
    titulo: t,
    pontos: Math.min(pa.pontos, pb.pontos),
    soma: pa.pontos + pb.pontos,
    pct: Math.min(pa.pct, pb.pct),
    pessoas: [{ nome: nA, pct: pa.pct }, { nome: nB, pct: pb.pct }],
    motivos,
    agradaAmbos: pa.relevante && pb.relevante,
    relevante: pa.relevante || pb.relevante,
    cabe: pa.cabe
  };
}

function recomendarJuntos(j, excluir = [], quantidade = 3) {
  const faixa = infoFaixa(faixaDoPar(j));
  const candidatos = CATALOGO.filter(t =>
    t.classificacao <= faixa.max &&
    (j.comum.tipo === 'todos' || t.tipo === j.comum.tipo) &&
    !excluir.includes(t.id)
  );
  const pontuados = candidatos.map(t => pontuarJuntos(t, j))
    .sort((x, y) => (y.pontos - x.pontos) || (y.soma - x.soma));

  const escolhidos = pontuados.filter(p => p.agradaAmbos).slice(0, quantidade);
  // Faltou? Entram os que agradam pelo menos uma pessoa e, por último, os mais bem avaliados
  pontuados.filter(p => !p.agradaAmbos && p.relevante)
    .slice(0, quantidade - escolhidos.length)
    .forEach(p => escolhidos.push(p));
  if (escolhidos.length < quantidade) {
    pontuados
      .filter(p => !escolhidos.includes(p))
      .sort((x, y) => y.titulo.nota - x.titulo.nota)
      .slice(0, quantidade - escolhidos.length)
      .forEach(p => {
        p.motivos.unshift({ icone: '⭐', texto: 'Sugestão bem avaliada pelo público' });
        escolhidos.push(p);
      });
  }
  return escolhidos;
}

/** Quantos títulos o par pode receber (faixa mais restritiva + tipo). */
function totalDisponivelJuntos(j) {
  const faixa = infoFaixa(faixaDoPar(j));
  return CATALOGO.filter(t => t.classificacao <= faixa.max && (j.comum.tipo === 'todos' || t.tipo === j.comum.tipo)).length;
}

/* ================================================================
   4. COMPONENTES DE INTERFACE
   ================================================================ */

/** Nome lido pelo leitor de tela no pôster: título, compatibilidade, tipo e classificação (as etiquetas visuais ficam escondidas dele). */
function rotuloPoster(t, pct) {
  const classif = t.classificacao === 0 ? 'livre para todos os públicos' : `não recomendado para menores de ${t.classificacao} anos`;
  return `Ver detalhes de ${t.titulo}${pct !== null ? `, ${pct}% de compatibilidade` : ''}, ${t.tipo === 'serie' ? 'série' : 'filme'}, ${classif}`;
}

/** Pôster gerado com CSS (gradiente do gênero + emoji). Vira imagem real se a API estiver ativa. */
function posterHTML(t, { tag = 'button', extraClasse = '', comTags = true, pct = null } = {}) {
  const [c1, c2] = infoGenero(t.generos[0]).cores;
  const cache = Store.getTmdbCache()[t.id];
  const img = cache && cache.poster
    ? `<img class="poster__img" src="https://image.tmdb.org/t/p/w342${esc(cache.poster)}" alt="" loading="lazy">` : '';
  // O pôster é só visual (o clique do mouse abre os detalhes); para teclado e leitor de tela, o botão é o título do card
  const attrs = tag === 'button' ? `data-acao="detalhes" data-id="${t.id}" aria-hidden="true"` : 'aria-hidden="true"';
  tag = 'div';
  return `
    <${tag} class="poster ${img ? 'tem-img' : ''} ${extraClasse}" style="--c1:${c1};--c2:${c2}" data-poster="${t.id}" ${attrs}>
      ${img}
      ${comTags ? `<span class="poster__tags" aria-hidden="true">
        ${pct !== null ? `<span class="tag tag--match">${pct}% match</span>` : `<span class="tag">${tipoTexto(t)}</span>`}
        <span class="classif classif--${t.classificacao}" title="Classificação indicativa">${classifTexto(t.classificacao)}</span>
      </span>` : ''}
      <span class="poster__emoji" aria-hidden="true">${t.emoji}</span>
      <span class="poster__nome" aria-hidden="true">${esc(t.titulo)}</span>
    </${tag}>`;
}

function botaoFavHTML(id, compacto = false) {
  const fav = Store.isFavorito(id);
  return `<button type="button" class="btn btn--ghost btn--sm btn-fav" data-acao="favoritar" data-id="${id}" data-compacto="${compacto}" aria-pressed="${fav}">
      <span class="btn-fav__icon" aria-hidden="true">${fav ? '❤️' : '🤍'}</span>
      <span class="btn-fav__txt">${compacto ? (fav ? 'Salvo' : 'Salvar') : (fav ? 'Favorito' : 'Favoritar')}</span>
    </button>`;
}

/** Barrinhas "quanto cada um vai curtir" (modo Assistir junto). */
function duplaHTML(pessoas) {
  return `<ul class="dupla" aria-label="Quanto cada um vai curtir">
    ${pessoas.map((p, i) => `<li class="dupla__linha dupla__linha--${i ? 'b' : 'a'}">
      <span class="dupla__nome">${esc(p.nome)}</span>
      <span class="dupla__trilho" aria-hidden="true"><i style="width:${p.pct}%"></i></span>
      <b>${p.pct}%</b></li>`).join('')}
  </ul>`;
}

/** Card completo de um título. opcoes: { pct, motivos, trocar, indice, compacto, pessoas, acaoTrocar } */
function cardHTML(t, opcoes = {}) {
  const { pct = null, motivos = [], trocar = false, indice = 0, compacto = false, pessoas = null, acaoTrocar = 'trocar' } = opcoes;
  return `
    <article class="titulo-card" style="--i:${indice}" data-card="${t.id}">
      ${posterHTML(t, { pct })}
      <div class="titulo-card__body">
        <${compacto ? 'h2' : 'h3'} class="titulo-card__title"><button type="button" class="titulo-btn" data-acao="detalhes" data-id="${t.id}">${esc(t.titulo)}<span class="sr-only">${esc(rotuloPoster(t, pct).replace('Ver detalhes de ' + t.titulo, ''))}. Ver detalhes</span></button></${compacto ? 'h2' : 'h3'}>
        <div class="titulo-card__meta">
          <span class="nota" aria-label="Nota ${t.nota} de 10">⭐ ${t.nota.toFixed(1)}</span>
          <span>⏱ ${duracaoTexto(t)}</span>
          <span>${t.ano}</span>
        </div>
        <p class="titulo-card__genres">${compacto ? esc(t.generos[0]) : esc(t.generos.join(' · '))}</p>
        ${pessoas ? duplaHTML(pessoas) : ''}
        ${motivos.length ? `<ul class="motivos" aria-label="Por que recomendamos">
          ${motivos.map(m => `<li class="${m.aviso ? 'aviso' : ''}"><span aria-hidden="true">${m.icone}</span> ${esc(m.texto)}</li>`).join('')}
        </ul>` : ''}
        <div class="titulo-card__actions">
          ${botaoFavHTML(t.id, compacto)}
          ${trocar
            ? `<button type="button" class="btn btn--ghost btn--sm" data-acao="${acaoTrocar}" data-id="${t.id}" title="Trocar só esta sugestão">🔄 Trocar</button>`
            : `<button type="button" class="btn btn--ghost btn--sm btn-detalhes" data-acao="detalhes" data-id="${t.id}">Detalhes</button>`}
        </div>
      </div>
    </article>`;
}

function skeletonHTML(qtd = 3) {
  return Array.from({ length: qtd }, () => `
    <div class="skeleton" aria-hidden="true">
      <div class="skeleton__poster"></div>
      <div><div class="skeleton__line"></div><div class="skeleton__line skeleton__line--short"></div><div class="skeleton__line"></div></div>
    </div>`).join('');
}

function vazioHTML(emoji, titulo, texto, botao = '') {
  return `<div class="vazio"><span class="vazio__emoji" aria-hidden="true">${emoji}</span><h2>${titulo}</h2><p>${texto}</p>${botao}</div>`;
}

/** Notificação temporária. Pode ter um botão de ação (ex.: "Desfazer"). */
function toast(mensagem, { tipo = 'info', acao = null, aoClicar = null, duracao = 3500 } = {}) {
  const area = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${tipo === 'erro' ? 'toast--erro' : ''}`;
  el.innerHTML = `<span class="toast__msg">${esc(mensagem)}</span>${acao ? `<button type="button" class="toast__acao">${esc(acao)}</button>` : ''}`;
  area.appendChild(el);
  while (area.children.length > 3) area.firstElementChild.remove();

  if (tipo === 'erro') el.setAttribute('role', 'alert'); // erros são anunciados na hora pelo leitor de tela
  const fechar = () => { el.classList.add('saindo'); setTimeout(() => el.remove(), 250); };
  // O tempo para no mouse ou no foco do teclado, para dar tempo de ler e clicar em "Desfazer" (WCAG 2.2.1)
  let timer = setTimeout(fechar, acao ? duracao + 2500 : duracao);
  // pausa só quando o mouse se mexe sobre a notificação (se ela surgir sob um mouse parado, segue o tempo normal)
  el.addEventListener('pointermove', () => clearTimeout(timer));
  el.addEventListener('focusin', () => clearTimeout(timer));
  const retomar = () => { clearTimeout(timer); timer = setTimeout(fechar, 2500); };
  el.addEventListener('mouseleave', retomar);
  el.addEventListener('focusout', retomar);
  if (acao) {
    $('.toast__acao', el).addEventListener('click', () => { clearTimeout(timer); fechar(); aoClicar && aoClicar(); });
  }
}

/* ---- Modais ---- */
function abrirModal(id) {
  const dlg = document.getElementById(id);
  estado.ultimoFoco = document.activeElement;
  if (!dlg.open) dlg.showModal();
}

function fecharModal(dlg) {
  if (dlg && dlg.open) dlg.close();
}

/** Confirmação antes de ações destrutivas (prevenção de erros). Retorna Promise<boolean>. */
function confirmar(titulo, texto, rotuloSim = 'Confirmar') {
  return new Promise(resolve => {
    const dlg = $('#dlg-confirmar');
    $('#confirmar-titulo').textContent = titulo;
    $('#confirmar-texto').textContent = texto;
    $('#confirmar-sim').textContent = rotuloSim;
    const finalizar = valor => {
      $('#confirmar-sim').onclick = $('#confirmar-nao').onclick = null;
      dlg.onclose = null;
      fecharModal(dlg);
      resolve(valor);
    };
    $('#confirmar-sim').onclick = () => finalizar(true);
    $('#confirmar-nao').onclick = () => finalizar(false);
    dlg.onclose = () => finalizar(false);
    abrirModal('dlg-confirmar');
    $('#confirmar-nao').focus();
  });
}

function abrirDetalhes(id) {
  const t = buscarTitulo(id);
  if (!t) return;
  const cache = Store.getTmdbCache()[t.id] || {};
  const sinopse = cache.sinopse || t.sinopse;
  $('#det-conteudo').innerHTML = `
    <button type="button" class="modal__close" data-fechar aria-label="Fechar">✕</button>
    ${posterHTML(t, { tag: 'div', extraClasse: 'det__poster', comTags: false })}
    <div class="det__info">
      <h2 id="det-titulo">${esc(t.titulo)}</h2>
      <div class="det__meta">
        <span class="classif classif--${t.classificacao}" title="Classificação indicativa">${classifTexto(t.classificacao)}</span>
        <span>${tipoTexto(t)}</span><span>${t.ano}</span><span>⏱ ${duracaoTexto(t)}</span>
        <span class="nota">⭐ ${t.nota.toFixed(1)}</span>
        ${cache.nota ? `<span title="Nota no TMDb">TMDb ${Number(cache.nota).toFixed(1)}</span>` : ''}
      </div>
      <div class="det__generos">${t.generos.map(g => `<span class="pill">${infoGenero(g).emoji} ${esc(g)}</span>`).join('')}</div>
      <p class="det__sinopse">${esc(sinopse)}</p>
      <p class="det__fonte">Bom para: ${t.humores.map(h => `${infoHumor(h).emoji} ${infoHumor(h).label}`).join(' · ')}</p>
      <div class="det__actions">
        ${botaoFavHTML(t.id)}
        <button type="button" class="btn btn--ghost btn--sm" data-acao="copiar" data-id="${t.id}">📋 Copiar dica</button>
        <a class="btn btn--ghost btn--sm" href="https://www.google.com/search?q=${encodeURIComponent(`onde assistir ${t.titulo} ${t.ano}`)}" target="_blank" rel="noopener">📍 Onde assistir</a>
      </div>
    </div>`;
  abrirModal('dlg-detalhes');
  TMDB.enriquecerVisiveis($('#dlg-detalhes'));
}

/** Atualiza todos os botões de favorito de um título (em qualquer tela). */
function sincronizarFavoritos(id) {
  const fav = Store.isFavorito(id);
  $$(`.btn-fav[data-id="${id}"]`).forEach(btn => {
    const compacto = btn.dataset.compacto === 'true';
    btn.setAttribute('aria-pressed', fav);
    $('.btn-fav__icon', btn).textContent = fav ? '❤️' : '🤍';
    $('.btn-fav__txt', btn).textContent = compacto ? (fav ? 'Salvo' : 'Salvar') : (fav ? 'Favorito' : 'Favoritar');
  });
  atualizarBadge(true);
}

function atualizarBadge(animar = false) {
  const badge = $('#badge-favoritos');
  const total = Store.getFavoritos().filter(f => buscarTitulo(f.id)).length; // ignora ids que não existem no catálogo
  badge.textContent = total;
  badge.hidden = total === 0;
  if (animar) { badge.classList.remove('pop'); void badge.offsetWidth; badge.classList.add('pop'); }
}

function alternarFavorito(id, botao) {
  const t = buscarTitulo(id);
  if (Store.isFavorito(id)) {
    const removido = Store.removerFavorito(id);
    toast(`${t.titulo} saiu dos favoritos`, {
      acao: 'Desfazer',
      aoClicar: () => { Store.adicionarFavorito(id, removido); sincronizarFavoritos(id); renderAtual(); }
    });
  } else {
    Store.adicionarFavorito(id);
    toast(`❤️ ${t.titulo} salvo nos favoritos`, { acao: 'Ver lista', aoClicar: () => irPara('favoritos') });
    marcarEtapa(3);
  }
  sincronizarFavoritos(id);
  if (botao) { botao.classList.remove('pop'); void botao.offsetWidth; botao.classList.add('pop'); }
  if (estado.view === 'favoritos' || estado.view === 'estatisticas') renderAtual();
}

/* ================================================================
   5. TELAS
   ================================================================ */

/* ---------------- 5.1 RECOMENDAR ---------------- */
function montarFormulario() {
  $('#lista-generos').innerHTML = GENEROS.map(g => `
    <label class="chip"><input type="checkbox" name="genero" value="${esc(g.id)}"><span>${g.emoji} ${esc(g.id)}</span></label>`).join('');

  $('#lista-humores').innerHTML = HUMORES.map(h => `
    <label class="mood"><input type="radio" name="humor" value="${h.id}"><span><b aria-hidden="true">${h.emoji}</b>${esc(h.label)}</span></label>`).join('');

  $('#lista-tempos').innerHTML = TEMPOS.map(t => `
    <label class="chip"><input type="radio" name="tempo" value="${t.id}"><span>${esc(t.label)}</span></label>`).join('');

  $('#faixa').insertAdjacentHTML('beforeend', FAIXAS.map(f => `<option value="${f.id}">${esc(f.label)}</option>`).join(''));
  $('#filtro-genero').insertAdjacentHTML('beforeend', GENEROS.map(g => `<option value="${esc(g.id)}">${g.emoji} ${esc(g.id)}</option>`).join(''));
}

function lerPreferencias() {
  const form = $('#form-prefs');
  return {
    tipo: form.querySelector('input[name="tipo"]:checked')?.value || 'todos',
    generos: $$('input[name="genero"]:checked', form).map(i => i.value),
    humor: form.querySelector('input[name="humor"]:checked')?.value || '',
    tempo: form.querySelector('input[name="tempo"]:checked')?.value || '',
    faixa: $('#faixa').value
  };
}

const PREFS_VAZIAS = { tipo: 'todos', generos: [], humor: '', tempo: '', faixa: '' };

function preencherFormulario(p) {
  // Correção (revisão de código): sem preferências salvas, o formulário é limpo explicitamente.
  // Antes ele ficava como estava, e o navegador podia restaurar marcações antigas ao recarregar.
  p = p || PREFS_VAZIAS;
  const form = $('#form-prefs');
  $$('input', form).forEach(i => {
    if (i.name === 'tipo') i.checked = i.value === p.tipo;
    if (i.name === 'genero') i.checked = p.generos.includes(i.value);
    if (i.name === 'humor') i.checked = i.value === p.humor;
    if (i.name === 'tempo') i.checked = i.value === p.tempo;
  });
  $('#faixa').value = p.faixa || '';
}

function validar(p) {
  const erros = [];
  if (!p.generos.length) erros.push({ campo: 'genero', msg: 'Escolha pelo menos um gênero.' });
  if (!p.humor) erros.push({ campo: 'humor', msg: 'Conte como você está se sentindo.' });
  if (!p.tempo) erros.push({ campo: 'tempo', msg: 'Informe quanto tempo você tem.' });
  if (!p.faixa) erros.push({ campo: 'faixa', msg: 'Selecione a faixa etária de quem vai assistir.' });
  return erros;
}

function mostrarErros(erros) {
  ['genero', 'humor', 'tempo', 'faixa'].forEach(campo => {
    const erro = erros.find(e => e.campo === campo);
    const caixa = $(`#campo-${campo}`);
    const msg = $(`#erro-${campo}`);
    caixa.classList.toggle('is-invalid', !!erro);
    if (campo === 'faixa') $('#faixa').setAttribute('aria-invalid', !!erro);
    msg.hidden = !erro;
    msg.textContent = erro ? erro.msg : '';
  });
}

function resumoPrefs(p) {
  const h = infoHumor(p.humor);
  const tipo = { todos: 'Filmes e séries', filme: 'Filmes', serie: 'Séries' }[p.tipo];
  return [`${h.emoji} ${h.label}`, `⏱ ${infoTempo(p.tempo).label}`, `🎞️ ${tipo}`, `🎯 ${p.generos.join(', ')}`, `👤 ${infoFaixa(p.faixa).label}`];
}

function marcarEtapa(n) {
  [1, 2, 3].forEach(i => {
    const el = $(`#step-${i}`);
    el.classList.toggle('is-active', i === n);
    el.classList.toggle('is-done', i < n);
  });
}

async function aoEnviarFormulario(evento) {
  evento.preventDefault();
  const prefs = lerPreferencias();
  const erros = validar(prefs);
  mostrarErros(erros);
  if (erros.length) {
    toast('Faltou preencher algumas informações 👆', { tipo: 'erro' });
    const primeiro = $(`#campo-${erros[0].campo}`);
    primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (primeiro.querySelector('input, select') || primeiro).focus({ preventScroll: true });
    return;
  }
  Store.salvarPrefs(prefs);
  estado.jaMostrados = [];
  await gerarRecomendacoes(prefs);
}

async function gerarRecomendacoes(prefs) {
  // Correção (revisão de código): um segundo clique durante o carregamento gerava duas buscas
  // ao mesmo tempo e duplicava o histórico. Agora só uma busca roda por vez.
  if (estado.carregando || !prefs) return;
  estado.carregando = true;
  const perfilInicial = Store.getPerfilAtivo().id;
  const botao = $('#btn-recomendar');
  const lista = $('#lista-resultados');
  const secao = $('#resultados');
  const outrosBotoes = [$('#btn-outras'), $('#btn-surpresa')];

  // 1) Feedback imediato: botão "carregando" + esqueleto dos cards
  botao.disabled = true;
  outrosBotoes.forEach(b => { b.disabled = true; });
  botao.innerHTML = '<span class="spinner" aria-hidden="true"></span> Procurando…';
  secao.hidden = false;
  lista.setAttribute('aria-busy', 'true');
  lista.innerHTML = skeletonHTML(3);
  $('#resumo-prefs').textContent = resumoPrefs(prefs).join('  ·  ');
  secao.scrollIntoView({ behavior: 'smooth', block: 'start' });
  await esperar(650);

  const liberar = () => {
    estado.carregando = false;
    botao.disabled = false;
    outrosBotoes.forEach(b => { b.disabled = false; });
    botao.innerHTML = '<span class="btn__icon" aria-hidden="true">✨</span> Recomendar';
    lista.setAttribute('aria-busy', 'false');
  };
  // Correção: se o perfil foi trocado durante a espera, descarta o resultado
  // (antes o histórico era salvo no perfil novo, que não pediu nada)
  if (Store.getPerfilAtivo().id !== perfilInicial) { liberar(); return; }

  // 2) Se já mostramos quase tudo, recomeça a rodada
  if (totalDisponivel(prefs) - estado.jaMostrados.length < 3) {
    if (estado.jaMostrados.length) toast('Você já viu todas as opções para esse perfil — recomeçando a lista 🔁');
    estado.jaMostrados = [];
  }

  const recs = recomendar(prefs, estado.jaMostrados);
  estado.prefsAtuais = prefs;
  estado.resultados = recs;
  estado.jaMostrados.push(...recs.map(r => r.titulo.id));

  renderResultados();
  if (recs.length) Store.adicionarHistorico(prefs, recs.map(r => r.titulo.id));

  liberar();
  marcarEtapa(2);
}

function renderResultados() {
  const lista = $('#lista-resultados');
  const recs = estado.resultados;
  $('#titulo-resultados').textContent = recs.length === 3 ? 'Recomendação de 3 sugestões' : `Encontramos ${recs.length} sugestão(ões)`;
  // Melhoria (revisão de código): explica por que vieram menos de 3 e o que fazer
  if (recs.length && recs.length < 3 && estado.prefsAtuais) {
    $('#resumo-prefs').textContent += `  ·  Só há ${recs.length} título(s) no catálogo para essa faixa etária e tipo. Tente “Tanto faz” no tipo.`;
  }
  lista.innerHTML = recs.length
    ? recs.map((r, i) => cardHTML(r.titulo, { pct: r.pct, motivos: r.motivos, trocar: true, indice: i })).join('')
    : vazioHTML('🤷', 'Nada encontrado', 'Tente outra faixa etária ou escolha "Tanto faz" no tipo.');
  $('#btn-outras').hidden = !recs.length;
  TMDB.enriquecerVisiveis(lista);
}

/** Troca apenas um dos cards por outro título. */
function trocarSugestao(id) {
  if (estado.carregando) return;
  const prefs = estado.prefsAtuais;
  const atuais = estado.resultados.map(r => r.titulo.id);
  let novo = recomendar(prefs, [...new Set([...estado.jaMostrados, ...atuais])], 1)[0];
  if (!novo) {
    novo = recomendar(prefs, atuais, 1)[0]; // já viu tudo: permite repetir os antigos
    if (!novo) return toast('Não há outras opções para essas preferências.', { tipo: 'erro' });
  }
  const pos = atuais.indexOf(id);
  estado.resultados[pos] = novo;
  estado.jaMostrados.push(novo.titulo.id);
  Store.atualizarUltimoHistorico(estado.resultados.map(r => r.titulo.id));

  const cardAntigo = $(`[data-card="${id}"]`, $('#lista-resultados'));
  cardAntigo.outerHTML = cardHTML(novo.titulo, { pct: novo.pct, motivos: novo.motivos, trocar: true, indice: 0 });
  TMDB.enriquecerVisiveis($('#lista-resultados'));
  toast(`Trocamos por ${novo.titulo.titulo} 🔄`);
}

/** "Surpreenda-me": escolhe preferências aleatórias e já recomenda. */
function surpreender() {
  if (estado.carregando) return;
  const p = {
    tipo: ['todos', 'filme', 'serie'][Math.floor(Math.random() * 3)],
    generos: embaralhar(GENEROS.map(g => g.id)).slice(0, 2),
    humor: embaralhar(HUMORES)[0].id,
    tempo: embaralhar(TEMPOS)[0].id,
    faixa: $('#faixa').value || '12' // respeita a faixa já escolhida
  };
  preencherFormulario(p);
  mostrarErros([]);
  toast('🎲 Escolhemos preferências aleatórias para você!');
  estado.jaMostrados = [];
  Store.salvarPrefs(p);
  gerarRecomendacoes(p);
}

/* ---------------- 5.1b ASSISTIR JUNTO ---------------- */
const LADOS = [['a', 1], ['b', 2]];
const CAMPOS_JUNTOS = ['j-tempo', 'j-a-genero', 'j-a-humor', 'j-a-faixa', 'j-b-genero', 'j-b-humor', 'j-b-faixa'];

/** Bloco de uma pessoa no formulário (gerado duas vezes, uma para cada lado). */
function pessoaHTML(lado, n) {
  const id = campo => `j-${lado}-${campo}`;
  return `
    <fieldset class="pessoa pessoa--${lado}" id="${id('bloco')}">
      <legend class="pessoa__titulo"><span class="pessoa__num" aria-hidden="true">${n}</span><span id="${id('legenda')}">Pessoa ${n}</span></legend>
      <div class="field">
        <label class="field__label" for="${id('nome')}">Nome <small>(opcional)</small></label>
        <input type="text" class="input" id="${id('nome')}" maxlength="20" placeholder="Pessoa ${n}" autocomplete="off">
      </div>
      <fieldset class="field" id="campo-${id('genero')}" aria-describedby="erro-${id('genero')}">
        <legend>Gêneros favoritos <span class="req" aria-hidden="true">*</span> <small>(um ou mais)</small></legend>
        <div class="chips">${GENEROS.map(g => `
          <label class="chip"><input type="checkbox" name="${id('genero')}" value="${esc(g.id)}"><span>${g.emoji} ${esc(g.id)}</span></label>`).join('')}</div>
        <p class="erro" id="erro-${id('genero')}" role="alert" hidden></p>
      </fieldset>
      <fieldset class="field" id="campo-${id('humor')}" aria-describedby="erro-${id('humor')}">
        <legend>Como está se sentindo? <span class="req" aria-hidden="true">*</span></legend>
        <div class="moods moods--compact">${HUMORES.map(h => `
          <label class="mood"><input type="radio" name="${id('humor')}" value="${h.id}"><span><b aria-hidden="true">${h.emoji}</b>${esc(h.label)}</span></label>`).join('')}</div>
        <p class="erro" id="erro-${id('humor')}" role="alert" hidden></p>
      </fieldset>
      <div class="field" id="campo-${id('faixa')}">
        <label class="field__label" for="${id('faixa')}">Faixa etária <span class="req" aria-hidden="true">*</span></label>
        <select id="${id('faixa')}" class="select" aria-describedby="erro-${id('faixa')}" required>
          <option value="">Selecione…</option>
          ${FAIXAS.map(f => `<option value="${f.id}">${esc(f.label)}</option>`).join('')}
        </select>
        <p class="erro" id="erro-${id('faixa')}" role="alert" hidden></p>
      </div>
    </fieldset>`;
}

function montarFormularioJuntos() {
  $('#lista-j-tempos').innerHTML = TEMPOS.map(t => `
    <label class="chip"><input type="radio" name="j-tempo" value="${t.id}"><span>${esc(t.label)}</span></label>`).join('');
  $('#pessoas').innerHTML = LADOS.map(([lado, n]) => pessoaHTML(lado, n)).join('');
}

function lerJuntos() {
  const form = $('#form-juntos');
  const pessoa = lado => ({
    nome: $(`#j-${lado}-nome`).value.trim().slice(0, 20),
    generos: $$(`input[name="j-${lado}-genero"]:checked`, form).map(i => i.value),
    humor: form.querySelector(`input[name="j-${lado}-humor"]:checked`)?.value || '',
    faixa: $(`#j-${lado}-faixa`).value
  });
  return {
    comum: {
      tipo: form.querySelector('input[name="j-tipo"]:checked')?.value || 'todos',
      tempo: form.querySelector('input[name="j-tempo"]:checked')?.value || ''
    },
    a: pessoa('a'),
    b: pessoa('b')
  };
}

/** Mostra o nome digitado no título de cada bloco ("Pessoa 1" → "Ana"). */
function atualizarNomesJuntos() {
  LADOS.forEach(([lado, n]) => { $(`#j-${lado}-legenda`).textContent = nomeDaPessoa({ nome: $(`#j-${lado}-nome`).value }, n); });
}

function preencherJuntos(j) {
  const perfil = Store.getPerfilAtivo();
  const vazio = { nome: '', generos: [], humor: '', faixa: '' };
  // Sem escolhas salvas, a Pessoa 1 já vem com o nome do perfil (se não for o padrão "Eu")
  j = j || { comum: { tipo: 'todos', tempo: '' }, a: { ...vazio, nome: perfil.nome === 'Eu' ? '' : perfil.nome }, b: vazio };
  const form = $('#form-juntos');
  $$('input[name="j-tipo"]', form).forEach(i => { i.checked = i.value === j.comum.tipo; });
  $$('input[name="j-tempo"]', form).forEach(i => { i.checked = i.value === j.comum.tempo; });
  LADOS.forEach(([lado]) => {
    const p = j[lado];
    $(`#j-${lado}-nome`).value = p.nome || '';
    $$(`input[name="j-${lado}-genero"]`, form).forEach(i => { i.checked = p.generos.includes(i.value); });
    $$(`input[name="j-${lado}-humor"]`, form).forEach(i => { i.checked = i.value === p.humor; });
    $(`#j-${lado}-faixa`).value = p.faixa || '';
  });
  atualizarNomesJuntos();
}

function validarJuntos(j) {
  const erros = [];
  if (!j.comum.tempo) erros.push({ campo: 'j-tempo', msg: 'Informe quanto tempo vocês têm.' });
  LADOS.forEach(([lado, n]) => {
    const p = j[lado], nome = nomeDaPessoa(p, n);
    if (!p.generos.length) erros.push({ campo: `j-${lado}-genero`, msg: `Escolha pelo menos um gênero para ${nome}.` });
    if (!p.humor) erros.push({ campo: `j-${lado}-humor`, msg: `Conte como ${nome} está se sentindo.` });
    if (!p.faixa) erros.push({ campo: `j-${lado}-faixa`, msg: `Selecione a faixa etária de ${nome}.` });
  });
  return erros;
}

function mostrarErrosJuntos(erros) {
  CAMPOS_JUNTOS.forEach(campo => {
    const erro = erros.find(e => e.campo === campo);
    $(`#campo-${campo}`).classList.toggle('is-invalid', !!erro);
    if (campo.endsWith('faixa')) $(`#${campo}`).setAttribute('aria-invalid', !!erro);
    const msg = $(`#erro-${campo}`);
    msg.hidden = !erro;
    msg.textContent = erro ? erro.msg : '';
  });
}

function resumoJuntos(j) {
  const nA = nomeDaPessoa(j.a, 1), nB = nomeDaPessoa(j.b, 2);
  const tipo = { todos: 'Filmes e séries', filme: 'Filmes', serie: 'Séries' }[j.comum.tipo];
  const faixa = faixaDoPar(j);
  const quem = j.a.faixa === j.b.faixa ? '' : ` (vale a de ${faixa === j.a.faixa ? nA : nB})`;
  return [`👥 ${nA} + ${nB}`, `⏱ ${infoTempo(j.comum.tempo).label}`, `🎞️ ${tipo}`, `👤 ${infoFaixa(faixa).label}${quem}`];
}

async function aoEnviarJuntos(evento) {
  evento.preventDefault();
  const j = lerJuntos();
  const erros = validarJuntos(j);
  mostrarErrosJuntos(erros);
  if (erros.length) {
    toast('Faltou preencher algumas informações 👆', { tipo: 'erro' });
    const primeiro = $(`#campo-${erros[0].campo}`);
    primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (primeiro.querySelector('input, select') || primeiro).focus({ preventScroll: true });
    return;
  }
  Store.salvarJuntos(j);
  estado.juntos.jaMostrados = [];
  await gerarJuntos(j);
}

async function gerarJuntos(j) {
  if (estado.carregando || !j) return;
  estado.carregando = true;
  const perfilInicial = Store.getPerfilAtivo().id;
  const botao = $('#btn-juntos');
  const lista = $('#lista-juntos');
  const secao = $('#resultados-juntos');
  const outras = $('#btn-outras-juntos');

  botao.disabled = true;
  outras.disabled = true;
  botao.innerHTML = '<span class="spinner" aria-hidden="true"></span> Procurando…';
  secao.hidden = false;
  lista.setAttribute('aria-busy', 'true');
  lista.innerHTML = skeletonHTML(3);
  $('#resumo-juntos').textContent = resumoJuntos(j).join('  ·  ');
  secao.scrollIntoView({ behavior: 'smooth', block: 'start' });
  await esperar(650);

  const liberar = () => {
    estado.carregando = false;
    botao.disabled = false;
    outras.disabled = false;
    botao.innerHTML = '<span class="btn__icon" aria-hidden="true">💞</span> Encontrar para nós dois';
    lista.setAttribute('aria-busy', 'false');
  };
  if (Store.getPerfilAtivo().id !== perfilInicial) { liberar(); return; }

  const ctl = estado.juntos;
  if (totalDisponivelJuntos(j) - ctl.jaMostrados.length < 3) {
    if (ctl.jaMostrados.length) toast('Vocês já viram todas as opções — recomeçando a lista 🔁');
    ctl.jaMostrados = [];
  }
  const recs = recomendarJuntos(j, ctl.jaMostrados);
  ctl.prefs = j;
  ctl.resultados = recs;
  ctl.jaMostrados.push(...recs.map(r => r.titulo.id));

  renderJuntos();
  if (recs.length) Store.adicionarHistorico({ modo: 'juntos', ...j }, recs.map(r => r.titulo.id));
  liberar();
}

function renderJuntos() {
  const { resultados: recs, prefs: j } = estado.juntos;
  const lista = $('#lista-juntos');
  const nomes = j ? `${nomeDaPessoa(j.a, 1)} e ${nomeDaPessoa(j.b, 2)}` : 'vocês dois';
  $('#titulo-resultados-juntos').textContent = recs.length === 3 ? `3 sugestões para ${nomes}` : `${recs.length} sugestão(ões) para ${nomes}`;
  if (recs.length && !recs.some(r => r.agradaAmbos)) {
    $('#resumo-juntos').textContent += '  ·  Os gostos estão bem diferentes: estas são as opções mais próximas. Tente escolher mais gêneros.';
  }
  lista.innerHTML = recs.length
    ? recs.map((r, i) => cardHTML(r.titulo, { pct: r.pct, motivos: r.motivos, pessoas: r.pessoas, trocar: true, acaoTrocar: 'trocar-juntos', indice: i })).join('')
    : vazioHTML('🤷', 'Nada encontrado', 'Tente outra faixa etária ou escolha "Tanto faz" no tipo.');
  $('#btn-outras-juntos').hidden = !recs.length;
  TMDB.enriquecerVisiveis(lista);
}

/** Troca apenas um dos cards do par por outro título. */
function trocarJuntos(id) {
  if (estado.carregando) return;
  const ctl = estado.juntos;
  const atuais = ctl.resultados.map(r => r.titulo.id);
  let novo = recomendarJuntos(ctl.prefs, [...new Set([...ctl.jaMostrados, ...atuais])], 1)[0];
  if (!novo) {
    novo = recomendarJuntos(ctl.prefs, atuais, 1)[0];
    if (!novo) return toast('Não há outras opções para vocês dois.', { tipo: 'erro' });
  }
  ctl.resultados[atuais.indexOf(id)] = novo;
  ctl.jaMostrados.push(novo.titulo.id);
  Store.atualizarUltimoHistorico(ctl.resultados.map(r => r.titulo.id));
  $(`[data-card="${id}"]`, $('#lista-juntos')).outerHTML =
    cardHTML(novo.titulo, { pct: novo.pct, motivos: novo.motivos, pessoas: novo.pessoas, trocar: true, acaoTrocar: 'trocar-juntos' });
  TMDB.enriquecerVisiveis($('#lista-juntos'));
  toast(`Trocamos por ${novo.titulo.titulo} 🔄`);
}

/* ---------------- 5.2 EXPLORAR (BUSCA) ---------------- */
function renderExplorar() {
  const termo = normalizar($('#busca').value.trim());
  const genero = $('#filtro-genero').value;
  const tipo = $('#filtro-tipo').value;
  const ordem = $('#ordem-busca').value;

  let lista = CATALOGO.filter(t => {
    // cada palavra digitada precisa ser o começo de alguma palavra do título/gênero/ano
    const palavras = normalizar(`${t.titulo} ${t.original} ${t.ano} ${t.generos.join(' ')}`).split(/[^a-z0-9]+/);
    return (!termo || termo.split(/\s+/).every(p => palavras.some(w => w.startsWith(p)))) &&
           (!genero || t.generos.includes(genero)) &&
           (!tipo || t.tipo === tipo);
  });

  const ordenadores = {
    nota: (a, b) => b.nota - a.nota,
    titulo: (a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'),
    recentes: (a, b) => b.ano - a.ano,
    curtos: (a, b) => a.duracao - b.duracao
  };
  lista.sort(ordenadores[ordem]);

  $('#contador-busca').textContent = `${lista.length} título(s) encontrado(s)${termo ? ` para “${$('#busca').value.trim()}”` : ''}`;
  $('#lista-busca').innerHTML = lista.length
    ? lista.map((t, i) => cardHTML(t, { indice: Math.min(i, 8), compacto: true })).join('')
    : vazioHTML('🔎', 'Nenhum título no catálogo local', 'Confira a ortografia ou limpe os filtros.' +
        (Store.getTmdbKey() ? ' Veja abaixo os resultados online.' : ''));
  TMDB.enriquecerVisiveis($('#lista-busca'));

  $('#api-cta').hidden = !!Store.getTmdbKey();
  buscarOnline($('#busca').value.trim());
}

const buscarOnline = debounce(async termo => {
  const secao = $('#secao-online');
  if (!Store.getTmdbKey() || termo.length < 3) { secao.hidden = true; return; }
  try {
    const resultados = await TMDB.buscar(termo);
    secao.hidden = false;
    $('#lista-online').innerHTML = resultados.length
      ? resultados.map((r, i) => cardOnlineHTML(r, i)).join('')
      : vazioHTML('🌐', 'Nada encontrado no TMDb', 'Tente outro termo de busca.');
  } catch (erro) {
    secao.hidden = true;
  }
}, 450);

function cardOnlineHTML(r, i) {
  const titulo = r.title || r.name || 'Sem título';
  const ano = (r.release_date || r.first_air_date || '').slice(0, 4);
  const tipo = r.media_type === 'tv' ? '📺 Série' : '🎬 Filme';
  const poster = r.poster_path
    ? `<img class="poster__img" src="https://image.tmdb.org/t/p/w342${esc(r.poster_path)}" alt="" loading="lazy">` : '';
  const link = `https://www.themoviedb.org/${r.media_type}/${r.id}?language=pt-BR`;
  return `
    <article class="titulo-card" style="--i:${Math.min(i, 8)}">
      <a class="poster ${poster ? 'tem-img' : ''}" href="${link}" target="_blank" rel="noopener" aria-hidden="true" tabindex="-1">
        ${poster}<span class="poster__tags"><span class="tag">${tipo}</span></span>
        <span class="poster__emoji" aria-hidden="true">🎞️</span><span class="poster__nome">${esc(titulo)}</span>
      </a>
      <div class="titulo-card__body">
        <h3 class="titulo-card__title">${esc(titulo)}</h3>
        <div class="titulo-card__meta"><span class="nota">⭐ ${Number(r.vote_average || 0).toFixed(1)}</span><span>${esc(ano)}</span></div>
        <div class="titulo-card__actions"><a class="btn btn--ghost btn--sm" href="${link}" target="_blank" rel="noopener">Ver no TMDb ↗</a></div>
      </div>
    </article>`;
}

/* ---------------- 5.3 FAVORITOS ---------------- */
function estrelasHTML(id, nota) {
  return `<div class="estrelas" role="group" aria-label="Minha avaliação">
    ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="estrela ${n <= nota ? 'on' : ''}" data-acao="avaliar" data-id="${id}" data-nota="${n}"
      aria-label="${n} de 5 estrelas" aria-pressed="${n === nota}">★</button>`).join('')}
  </div>`;
}

function renderFavoritos() {
  const ordem = $('#ordem-favoritos').value;
  const favs = Store.getFavoritos().filter(f => buscarTitulo(f.id));
  const ordenadores = {
    recentes: (a, b) => new Date(b.adicionadoEm) - new Date(a.adicionadoEm),
    'minha-nota': (a, b) => (b.minhaNota || 0) - (a.minhaNota || 0),
    nota: (a, b) => buscarTitulo(b.id).nota - buscarTitulo(a.id).nota,
    titulo: (a, b) => buscarTitulo(a.id).titulo.localeCompare(buscarTitulo(b.id).titulo, 'pt-BR')
  };
  favs.sort(ordenadores[ordem]);

  const filmes = favs.filter(f => buscarTitulo(f.id).tipo === 'filme').length;
  $('#sub-favoritos').textContent = favs.length
    ? `${favs.length} título(s) salvo(s) · ${filmes} filme(s) e ${favs.length - filmes} série(s). Avalie com estrelas!`
    : 'Salve títulos com ❤️ para encontrá-los aqui depois.';

  $('#lista-favoritos').innerHTML = favs.length
    ? favs.map((f, i) => {
        const t = buscarTitulo(f.id);
        return `
        <li class="fav-item" style="--i:${i}" data-fav="${t.id}">
          ${posterHTML(t)}
          <div class="fav-item__info">
            <h2><button type="button" class="titulo-btn" data-acao="detalhes" data-id="${t.id}">✔ ${esc(t.titulo)}<span class="sr-only">. Ver detalhes</span></button></h2>
            <p>${tipoTexto(t)} · ${t.ano} · ⏱ ${duracaoTexto(t)} · <span class="nota">⭐ ${t.nota.toFixed(1)}</span></p>
            <p>${esc(t.generos.join(' · '))}</p>
            ${estrelasHTML(t.id, f.minhaNota || 0)}
          </div>
          <div class="fav-item__actions">
            <button type="button" class="btn btn--ghost btn--sm" data-acao="detalhes" data-id="${t.id}">Detalhes</button>
            <button type="button" class="btn btn--danger-ghost btn--sm" data-acao="remover-fav" data-id="${t.id}" aria-label="Remover ${esc(t.titulo)} dos favoritos">🗑️ Remover</button>
          </div>
        </li>`;
      }).join('')
    : `<li class="vazio"><span class="vazio__emoji" aria-hidden="true">💔</span><h2>Sua lista está vazia</h2>
        <p>Peça uma recomendação e toque em <strong>Favoritar</strong> nos títulos que gostar.</p>
        <a class="btn btn--primary" href="#recomendar">✨ Pedir recomendação</a></li>`;
  TMDB.enriquecerVisiveis($('#lista-favoritos'));
}

function removerFavoritoDaLista(id) {
  const item = $(`[data-fav="${id}"]`);
  const t = buscarTitulo(id);
  const removido = Store.removerFavorito(id);
  const concluir = () => { renderFavoritos(); sincronizarFavoritos(id); };
  if (item) { item.classList.add('saindo'); setTimeout(concluir, 280); } else concluir();
  toast(`${t.titulo} removido dos favoritos`, {
    acao: 'Desfazer',
    aoClicar: () => { Store.adicionarFavorito(id, removido); renderAtual(); sincronizarFavoritos(id); }
  });
}

function avaliar(id, nota) {
  const atual = (Store.getFavoritos().find(f => f.id === id) || {}).minhaNota || 0;
  const nova = atual === nota ? 0 : nota; // clicar de novo na mesma estrela limpa a nota
  Store.avaliarFavorito(id, nova);
  const grupo = $(`[data-fav="${id}"] .estrelas`);
  $$('.estrela', grupo).forEach((b, i) => {
    b.classList.toggle('on', i < nova);
    b.setAttribute('aria-pressed', i + 1 === nova);
  });
  toast(nova ? `Você deu ${nova} ⭐ para ${buscarTitulo(id).titulo}` : 'Avaliação removida');
}

function exportarBackup() {
  const dados = JSON.stringify(Store.exportar(), null, 2);
  const url = URL.createObjectURL(new Blob([dados], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `cinematch-${Store.getPerfilAtivo().nome}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('⬇️ Backup baixado');
}

/**
 * Correção (revisão de código): um backup editado à mão ou de outra versão podia ter itens nulos
 * ou títulos que não existem, e isso travava as telas. Aqui só passa o que é válido.
 */
const pessoaValida = p => !!(p && Array.isArray(p.generos) && infoHumor(p.humor) && infoFaixa(p.faixa));
/** Preferências salvas no histórico são válidas? (modo normal ou "Assistir junto") */
function prefsValidas(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.modo === 'juntos') return !!(p.comum && infoTempo(p.comum.tempo) && pessoaValida(p.a) && pessoaValida(p.b));
  return pessoaValida(p) && !!infoTempo(p.tempo);
}

/* Leitura segura do que está salvo: dados de versões antigas ou estragados são ignorados */
const prefsSalvas = () => { const p = Store.getPrefs(); return prefsValidas(p) ? p : null; };
const juntosSalvos = () => { const j = Store.getJuntos(); return j && prefsValidas({ modo: 'juntos', ...j }) ? j : null; };
const historicoValido = () => Store.getHistorico().filter(h => prefsValidas(h.prefs));

function limparBackup(dados) {
  if (!dados || dados.app !== 'CineMatch' || !Array.isArray(dados.favoritos)) throw new Error('Backup inválido');
  const vistos = new Set();
  const favoritos = dados.favoritos.filter(f => {
    const ok = f && typeof f === 'object' && buscarTitulo(f.id) && !vistos.has(f.id);
    if (ok) vistos.add(f.id);
    return ok;
  }).map(f => ({
    id: f.id,
    adicionadoEm: isNaN(new Date(f.adicionadoEm)) ? new Date().toISOString() : f.adicionadoEm,
    minhaNota: [0, 1, 2, 3, 4, 5].includes(f.minhaNota) ? f.minhaNota : 0
  }));
  const historicoBruto = Array.isArray(dados.historico) ? dados.historico : [];
  const historico = historicoBruto.filter(h => h && prefsValidas(h.prefs) && Array.isArray(h.ids) && !isNaN(new Date(h.quando)));
  const ignorados = (dados.favoritos.length - favoritos.length) + (historicoBruto.length - historico.length);
  return { app: 'CineMatch', favoritos, historico, ignorados };
}

function importarBackup(arquivo) {
  const leitor = new FileReader();
  leitor.onload = async () => {
    try {
      const dados = limparBackup(JSON.parse(leitor.result));
      const ignorados = dados.ignorados ? ` (${dados.ignorados} item(ns) inválido(s) serão ignorados)` : '';
      const ok = await confirmar('Restaurar backup?', `Os favoritos e o histórico do perfil atual serão substituídos pelos ${dados.favoritos.length} favoritos do arquivo${ignorados}.`, 'Restaurar');
      if (!ok) return;
      Store.importar(dados);
      atualizarBadge(true);
      renderAtual();
      toast('✅ Backup restaurado');
    } catch (erro) {
      toast('Não consegui ler esse arquivo. Use um backup gerado pelo CineMatch.', { tipo: 'erro' });
    }
  };
  leitor.readAsText(arquivo);
}

/* ---------------- 5.4 HISTÓRICO ---------------- */
/** Resumo de uma entrada do histórico (modo normal ou "Assistir junto"). */
const resumoHistorico = p => (p.modo === 'juntos' ? resumoJuntos(p) : resumoPrefs(p));

function renderHistorico() {
  const historico = historicoValido();
  $('#btn-limpar-historico').hidden = !historico.length;
  $('#lista-historico').innerHTML = historico.length
    ? historico.map((h, i) => `
      <li class="hist-item" style="--i:${Math.min(i, 10)}" data-hist="${h.id}">
        <div class="hist-item__top">
          <span class="hist-item__data">🕘 ${formatarData(h.quando)}</span>
          <div class="section-head__actions">
            <button type="button" class="btn btn--ghost btn--sm" data-acao="repetir" data-hist="${h.id}">↺ Usar estas preferências</button>
            <button type="button" class="btn btn--text btn--sm" data-acao="remover-hist" data-hist="${h.id}" aria-label="Apagar esta entrada do histórico">✕</button>
          </div>
        </div>
        <div class="hist-item__prefs">${resumoHistorico(h.prefs).map(p => `<span class="pill">${esc(p)}</span>`).join('')}</div>
        <div class="hist-item__titulos">
          ${h.ids.map(buscarTitulo).filter(Boolean).map(t => {
            const [c1, c2] = infoGenero(t.generos[0]).cores;
            return `<button type="button" class="mini" data-acao="detalhes" data-id="${t.id}">
              <span class="mini__emoji" style="--c1:${c1};--c2:${c2}" aria-hidden="true">${t.emoji}</span>${esc(t.titulo)}
              ${Store.isFavorito(t.id) ? '<span aria-label="favorito">❤️</span>' : ''}</button>`;
          }).join('')}
        </div>
      </li>`).join('')
    : `<li class="vazio"><span class="vazio__emoji" aria-hidden="true">🕘</span><h2>Nenhuma recomendação ainda</h2>
        <p>Suas recomendações aparecem aqui automaticamente.</p><a class="btn btn--primary" href="#recomendar">✨ Pedir a primeira</a></li>`;
}

async function limparHistorico() {
  const ok = await confirmar('Limpar todo o histórico?', 'Essa ação apaga todas as recomendações salvas deste perfil e não pode ser desfeita. Seus favoritos continuam salvos.', 'Limpar tudo');
  if (!ok) return;
  Store.limparHistorico();
  renderHistorico();
  toast('🗑️ Histórico limpo');
}

function removerEntradaHistorico(idEntrada) {
  const antes = historicoValido();
  const item = $(`[data-hist="${idEntrada}"].hist-item`);
  Store.removerHistorico(idEntrada);
  if (item) item.classList.add('saindo');
  setTimeout(renderHistorico, 280);
  toast('Entrada removida do histórico', {
    acao: 'Desfazer',
    aoClicar: () => {
      // restaura a lista exatamente como estava
      Store.restaurarHistorico(antes);
      renderHistorico();
    }
  });
}

function repetirDoHistorico(idEntrada) {
  const h = historicoValido().find(x => x.id === idEntrada);
  if (!h) return;
  if (h.prefs.modo === 'juntos') {
    const { modo, ...j } = h.prefs;
    preencherJuntos(j);
    mostrarErrosJuntos([]);
    irPara('juntos');
    estado.juntos.jaMostrados = [];
    gerarJuntos(j);
    return;
  }
  preencherFormulario(h.prefs);
  mostrarErros([]);
  irPara('recomendar');
  estado.jaMostrados = [];
  gerarRecomendacoes(h.prefs);
}

/* ---------------- 5.5 ESTATÍSTICAS ---------------- */
function barrasHTML(contagem, total, rotulo) {
  const linhas = Object.entries(contagem).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return `<ul class="barras">${linhas.map(([nome, qtd]) => `
    <li>
      <div class="barra__top"><span>${rotulo(nome)}</span><span>${qtd}</span></div>
      <div class="barra__trilho" role="img" aria-label="${esc(nome)}: ${qtd}"><div class="barra__fill" style="width:${Math.round((qtd / total) * 100)}%"></div></div>
    </li>`).join('')}</ul>`;
}

function renderEstatisticas() {
  const favs = Store.getFavoritos().map(f => ({ ...f, t: buscarTitulo(f.id) })).filter(f => f.t);
  const historico = historicoValido();
  const alvo = $('#conteudo-estatisticas');

  if (!favs.length && !historico.length) {
    alvo.innerHTML = vazioHTML('📊', 'Ainda sem dados', 'Peça recomendações e salve favoritos para ver suas estatísticas.',
      '<a class="btn btn--primary" href="#recomendar">✨ Começar</a>');
    return;
  }

  const filmes = favs.filter(f => f.t.tipo === 'filme');
  const series = favs.length - filmes.length;
  const mediaPublico = favs.length ? (favs.reduce((s, f) => s + f.t.nota, 0) / favs.length).toFixed(1) : '–';
  const avaliados = favs.filter(f => f.minhaNota);
  const minhaMedia = avaliados.length ? (avaliados.reduce((s, f) => s + f.minhaNota, 0) / avaliados.length).toFixed(1) : '–';
  const minutosFilmes = filmes.reduce((s, f) => s + f.t.duracao, 0);

  const generos = {};
  favs.forEach(f => f.t.generos.forEach(g => { generos[g] = (generos[g] || 0) + 1; }));
  const humores = {};
  historico.forEach(h => {
    const daEntrada = h.prefs.modo === 'juntos' ? new Set([h.prefs.a.humor, h.prefs.b.humor]) : [h.prefs.humor];
    daEntrada.forEach(hu => { humores[hu] = (humores[hu] || 0) + 1; });
  });

  const pctFilmes = favs.length ? Math.round((filmes.length / favs.length) * 100) : 0;
  const melhor = [...favs].sort((a, b) => (b.minhaNota - a.minhaNota) || (b.t.nota - a.t.nota))[0];

  alvo.innerHTML = `
    <div class="kpis">
      <div class="card kpi"><span class="kpi__valor">${favs.length}</span><span class="kpi__label">❤️ Favoritos</span></div>
      <div class="card kpi"><span class="kpi__valor">${historico.length}</span><span class="kpi__label">✨ Recomendações pedidas</span></div>
      <div class="card kpi"><span class="kpi__valor">${mediaPublico}</span><span class="kpi__label">⭐ Nota média dos favoritos</span></div>
      <div class="card kpi"><span class="kpi__valor">${minutosFilmes ? formatarDuracao(minutosFilmes) : '–'}</span><span class="kpi__label">🍿 Para maratonar seus filmes</span></div>
    </div>
    <div class="graficos">
      <section class="card grafico">
        <h2>🎯 Gêneros favoritos</h2>
        ${favs.length ? barrasHTML(generos, favs.length, g => `${infoGenero(g).emoji} ${esc(g)}`) : '<p class="section-head__sub">Favorite títulos para ver seus gêneros.</p>'}
      </section>
      <section class="card grafico">
        <h2>😊 Humores mais pedidos</h2>
        ${historico.length ? barrasHTML(humores, historico.length, h => `${infoHumor(h).emoji} ${esc(infoHumor(h).label)}`) : '<p class="section-head__sub">Peça recomendações para ver seus humores.</p>'}
      </section>
      <section class="card grafico">
        <h2>🎬 Filmes × 📺 Séries</h2>
        ${favs.length ? `<div class="donut-wrap">
          <div class="donut" role="img" aria-label="${pctFilmes}% filmes e ${100 - pctFilmes}% séries" data-centro="${favs.length}"
            style="background: conic-gradient(var(--primary) 0 ${pctFilmes}%, var(--primary-2) ${pctFilmes}% 100%)"></div>
          <ul class="legenda">
            <li><i style="background:var(--primary)"></i>Filmes: ${filmes.length} (${pctFilmes}%)</li>
            <li><i style="background:var(--primary-2)"></i>Séries: ${series} (${100 - pctFilmes}%)</li>
          </ul></div>` : '<p class="section-head__sub">Sem favoritos ainda.</p>'}
      </section>
      <section class="card grafico">
        <h2>🏆 Seu destaque</h2>
        ${melhor ? `<div class="top-titulo">
            <div style="width:70px;flex:none">${posterHTML(melhor.t, { comTags: false })}</div>
            <div><h3>${esc(melhor.t.titulo)}</h3>
            <p class="section-head__sub">${melhor.minhaNota ? `Sua nota: ${'★'.repeat(melhor.minhaNota)}` : `Nota do público: ⭐ ${melhor.t.nota}`}</p>
            <p class="section-head__sub">Sua média de avaliação: ${minhaMedia} ★ (${avaliados.length} avaliado(s))</p></div>
          </div>` : '<p class="section-head__sub">Favorite e avalie títulos para ver seu destaque.</p>'}
      </section>
    </div>`;
  TMDB.enriquecerVisiveis(alvo);
}

/* ================================================================
   6. TEMA, PERFIS E AJUDA
   ================================================================ */
function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  const escuro = tema === 'dark';
  const btn = $('#btn-tema');
  btn.setAttribute('aria-pressed', escuro);
  btn.removeAttribute('aria-label'); // o nome acessível passa a ser o texto visível (WCAG 2.5.3)
  btn.title = escuro ? 'Light Mode: voltar ao tema claro (T)' : 'Dark Mode: ativar o tema escuro (T)';
  $('.btn-tema__icone', btn).textContent = escuro ? '☀️' : '🌙';
  $('.btn-tema__texto', btn).textContent = escuro ? 'Light Mode' : 'Dark Mode';
  $('meta[name="theme-color"]').setAttribute('content', escuro ? '#0e0b19' : '#6d28d9');
}

function alternarTema() {
  const novo = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  aplicarTema(novo);
  Store.salvarTema(novo);
  toast(novo === 'dark' ? '🌙 Dark Mode ativado' : '☀️ Light Mode ativado', { duracao: 1800 });
}

const AVATARES = ['🍿', '🎬', '🦸', '🐱', '🐶', '👾', '🌟', '🎮', '🦊', '👑'];

function atualizarPerfilNoTopo() {
  const p = Store.getPerfilAtivo();
  $('#perfil-avatar').textContent = p.avatar;
  $('#perfil-nome').textContent = p.nome;
  $('#btn-perfil').setAttribute('aria-label', `Perfil atual: ${p.nome}. Trocar de perfil`);
}

function renderPerfis() {
  const ativo = Store.getPerfilAtivo();
  const perfis = Store.getPerfis();
  $('#lista-perfis').innerHTML = perfis.map(p => `
    <li class="perfil">
      <button type="button" class="perfil__btn" data-acao="usar-perfil" data-perfil="${p.id}" aria-current="${p.id === ativo.id}">
        <span class="perfil__avatar" aria-hidden="true">${p.avatar}</span>${esc(p.nome)}
      </button>
      ${perfis.length > 1 ? `<button type="button" class="perfil__del" data-acao="excluir-perfil" data-perfil="${p.id}" aria-label="Excluir perfil ${esc(p.nome)}">✕</button>` : ''}
    </li>`).join('');
  $('#lista-avatares').innerHTML = AVATARES.map((a, i) => `
    <label class="chip"><input type="radio" name="avatar" value="${a}" ${i === 0 ? 'checked' : ''}><span aria-label="Avatar ${a}">${a}</span></label>`).join('');
}

function trocarPerfil(id) {
  Store.setPerfilAtivo(id);
  atualizarPerfilNoTopo();
  atualizarBadge();
  preencherFormulario(prefsSalvas());
  $('#resultados').hidden = true;
  estado.resultados = [];
  estado.jaMostrados = [];
  estado.prefsAtuais = null;
  preencherJuntos(juntosSalvos());
  mostrarErrosJuntos([]);
  $('#resultados-juntos').hidden = true;
  estado.juntos = { prefs: null, resultados: [], jaMostrados: [] };
  marcarEtapa(1);
  fecharModal($('#dlg-perfis'));
  renderAtual();
  toast(`Olá, ${Store.getPerfilAtivo().nome}! ${Store.getPerfilAtivo().avatar}`);
}

async function excluirPerfil(id) {
  const p = Store.getPerfis().find(x => x.id === id);
  const ok = await confirmar(`Excluir o perfil “${p.nome}”?`, 'Os favoritos e o histórico deste perfil serão apagados.', 'Excluir');
  abrirModal('dlg-perfis');
  if (!ok) return;
  Store.excluirPerfil(id);
  renderPerfis();
  atualizarPerfilNoTopo();
  atualizarBadge();
  renderAtual();
  toast('Perfil excluído');
}

function criarPerfil(evento) {
  evento.preventDefault();
  const nome = $('#perfil-nome-input').value.trim();
  const erro = $('#erro-perfil');
  if (!nome) {
    erro.textContent = 'Digite um nome para o perfil.'; erro.hidden = false; $('#perfil-nome-input').focus(); return;
  }
  if (Store.getPerfis().some(p => normalizar(p.nome) === normalizar(nome))) {
    erro.textContent = 'Já existe um perfil com esse nome.'; erro.hidden = false; return;
  }
  erro.hidden = true;
  const avatar = $('input[name="avatar"]:checked').value;
  const novo = Store.criarPerfil(nome, avatar);
  $('#perfil-nome-input').value = '';
  trocarPerfil(novo.id);
}

/* ================================================================
   7. INTEGRAÇÃO COM A API DO TMDb (BÔNUS)
   ----------------------------------------------------------------
   Opcional: sem chave o app funciona 100% com o catálogo local.
   Com chave: pôsteres reais, sinopses e busca online.
   Respostas ficam em cache no LocalStorage para economizar requisições.
   ================================================================ */
const TMDB = {
  base: 'https://api.themoviedb.org/3',
  emAndamento: new Set(),
  avisouErro: false,

  async requisitar(caminho, params = {}, chave = Store.getTmdbKey()) {
    const url = new URL(this.base + caminho);
    Object.entries({ language: 'pt-BR', ...params }).forEach(([k, v]) => url.searchParams.set(k, v));
    const headers = { accept: 'application/json' };
    // Token v4 (longo) vai no cabeçalho; chave v3 (32 caracteres) vai na URL
    if (chave.length > 40) headers.Authorization = `Bearer ${chave}`;
    else url.searchParams.set('api_key', chave);
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`TMDb respondeu ${resp.status}`);
    return resp.json();
  },

  async testar(chave) {
    await this.requisitar('/configuration', {}, chave);
    return true;
  },

  /** Busca pôster e sinopse de um título do catálogo (com cache). */
  async enriquecer(t) {
    const cache = Store.getTmdbCache();
    if (cache[t.id] || this.emAndamento.has(t.id)) return cache[t.id];
    this.emAndamento.add(t.id);
    try {
      const tipo = t.tipo === 'serie' ? 'tv' : 'movie';
      const params = { query: t.original };
      params[tipo === 'tv' ? 'first_air_date_year' : 'year'] = t.ano;
      const dados = await this.requisitar(`/search/${tipo}`, params);
      const r = (dados.results || [])[0];
      const info = r ? { poster: r.poster_path, sinopse: r.overview, nota: r.vote_average } : { poster: null };
      const novoCache = Store.getTmdbCache();
      novoCache[t.id] = info;
      Store.salvarTmdbCache(novoCache);
      return info;
    } catch (erro) {
      if (!this.avisouErro) {
        this.avisouErro = true;
        toast('Não foi possível falar com o TMDb. Usando o catálogo local.', { tipo: 'erro' });
      }
      return null;
    } finally {
      this.emAndamento.delete(t.id);
    }
  },

  /** Procura pôsteres para todos os cards visíveis dentro de um container. */
  enriquecerVisiveis(container) {
    if (!Store.getTmdbKey() || !container) return;
    $$('[data-poster]', container).forEach(async el => {
      if (el.classList.contains('tem-img')) return;
      const t = buscarTitulo(el.dataset.poster);
      const info = t && await this.enriquecer(t);
      if (info && info.poster && !el.classList.contains('tem-img')) {
        const img = new Image();
        img.className = 'poster__img';
        img.alt = '';
        img.onload = () => { el.prepend(img); el.classList.add('tem-img'); };
        img.src = `https://image.tmdb.org/t/p/w342${info.poster}`;
      }
    });
  },

  async buscar(termo) {
    const dados = await this.requisitar('/search/multi', { query: termo, include_adult: false });
    return (dados.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 8);
  }
};

function abrirConfigApi() {
  $$('dialog[open]').forEach(d => d.id !== 'dlg-api' && fecharModal(d));
  $('#api-key').value = Store.getTmdbKey();
  const status = $('#api-status');
  status.className = 'api-status';
  status.textContent = Store.getTmdbKey() ? '✅ API conectada.' : 'Nenhuma chave salva — usando o catálogo local.';
  abrirModal('dlg-api');
}

async function salvarApi() {
  const chave = $('#api-key').value.trim();
  const status = $('#api-status');
  if (!chave) { status.className = 'api-status erro-api'; status.textContent = '⚠️ Cole uma chave antes de salvar.'; return; }
  status.className = 'api-status';
  status.textContent = '⏳ Testando conexão…';
  try {
    await TMDB.testar(chave);
    Store.salvarTmdbKey(chave);
    TMDB.avisouErro = false;
    status.className = 'api-status ok';
    status.textContent = '✅ Conectado! Os pôsteres reais vão aparecer.';
    toast('🔌 API do TMDb conectada');
    setTimeout(() => { fecharModal($('#dlg-api')); renderAtual(); if (estado.resultados.length) renderResultados(); }, 900);
  } catch (erro) {
    status.className = 'api-status erro-api';
    status.textContent = '❌ Chave inválida ou sem conexão. Confira e tente de novo.';
  }
}

function removerApi() {
  Store.salvarTmdbKey('');
  Store.salvarTmdbCache({});
  $('#api-key').value = '';
  $('#api-status').className = 'api-status';
  $('#api-status').textContent = 'Chave removida. Usando o catálogo local.';
  renderAtual();
  if (estado.resultados.length) renderResultados();
}

/* ================================================================
   8. NAVEGAÇÃO, ATALHOS E EVENTOS
   ================================================================ */
const VIEWS = ['recomendar', 'explorar', 'favoritos', 'historico', 'estatisticas', 'juntos']; // atalhos 1–5 seguem esta ordem
const TITULOS = { recomendar: 'Recomendar', juntos: 'Assistir junto', explorar: 'Explorar', favoritos: 'Favoritos', historico: 'Histórico', estatisticas: 'Estatísticas' };
const RENDER = { recomendar: () => {}, juntos: () => {}, explorar: renderExplorar, favoritos: renderFavoritos, historico: renderHistorico, estatisticas: renderEstatisticas };

function irPara(view) {
  if (!VIEWS.includes(view)) view = 'recomendar';
  if (location.hash !== `#${view}`) { history.pushState(null, '', `#${view}`); }
  mostrarView(view);
}

function mostrarView(view, focar = true) {
  if (!VIEWS.includes(view)) view = 'recomendar';
  estado.view = view;
  VIEWS.forEach(v => { $(`#view-${v}`).hidden = v !== view; });
  const naNav = view === 'juntos' ? 'recomendar' : view; // "Assistir junto" é um modo da tela Recomendar
  $$('.nav__link').forEach(a => {
    if (a.dataset.view === naNav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${TITULOS[view]} · CineMatch`;
  RENDER[view]();
  window.scrollTo(0, 0);
  if (focar) {
    const titulo = $(`#view-${view} h1`);
    titulo.setAttribute('tabindex', '-1');
    titulo.focus({ preventScroll: true }); // leitores de tela anunciam a nova tela
  }
}

const renderAtual = () => RENDER[estado.view]();

/** Um único "ouvinte" de cliques para todos os botões com data-acao (delegação de eventos). */
function aoClicar(evento) {
  const alvo = evento.target.closest('[data-acao], [data-fechar], .nav__link, a[href^="#"]');
  if (!alvo) return;

  if (alvo.hasAttribute('data-fechar')) return fecharModal(alvo.closest('dialog'));

  if (alvo.matches('a[href^="#"]') && !alvo.dataset.acao) {
    const destino = alvo.getAttribute('href').slice(1);
    if (VIEWS.includes(destino)) {
      evento.preventDefault();
      fecharModal(alvo.closest('dialog'));
      irPara(destino);
    }
    return;
  }

  const { acao, id } = alvo.dataset;
  switch (acao) {
    case 'favoritar': alternarFavorito(id, alvo); break;
    case 'detalhes': abrirDetalhes(id); break;
    case 'trocar': trocarSugestao(id); break;
    case 'trocar-juntos': trocarJuntos(id); break;
    case 'remover-fav': removerFavoritoDaLista(id); break;
    case 'avaliar': avaliar(id, Number(alvo.dataset.nota)); break;
    case 'repetir': repetirDoHistorico(Number(alvo.dataset.hist)); break;
    case 'remover-hist': removerEntradaHistorico(Number(alvo.dataset.hist)); break;
    case 'usar-perfil': trocarPerfil(alvo.dataset.perfil); break;
    case 'excluir-perfil': excluirPerfil(alvo.dataset.perfil); break;
    case 'abrir-api': abrirConfigApi(); break;
    case 'copiar': copiarDica(id); break;
  }
}

async function copiarDica(id) {
  const t = buscarTitulo(id);
  const texto = `🎬 Dica do CineMatch: ${t.titulo} (${t.ano}) — ${t.generos.join(', ')} · ⭐ ${t.nota} · ${duracaoTexto(t)}. ${t.sinopse}`;
  try {
    await navigator.clipboard.writeText(texto);
    toast('📋 Dica copiada! É só colar e mandar para alguém.');
  } catch (_) {
    toast('Não consegui copiar automaticamente neste navegador.', { tipo: 'erro' });
  }
}

function aoPressionarTecla(e) {
  const digitando = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if (digitando || e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]')) return;
  if (!Store.getAtalhos()) return; // o usuário pode desligar os atalhos de uma tecla (WCAG 2.1.4)
  if (e.key >= '1' && e.key <= '5') { irPara(VIEWS[Number(e.key) - 1]); }
  else if (e.key.toLowerCase() === 't') { alternarTema(); }
  else if (e.key.toLowerCase() === 'j') { irPara('juntos'); }
  else if (e.key === '/') { e.preventDefault(); irPara('explorar'); $('#busca').focus(); }
  else if (e.key === '?') { abrirModal('dlg-ajuda'); }
}

function registrarEventos() {
  document.addEventListener('click', aoClicar);
  document.addEventListener('keydown', aoPressionarTecla);
  window.addEventListener('popstate', () => mostrarView(location.hash.slice(1) || 'recomendar', false));

  // Formulário de preferências
  const form = $('#form-prefs');
  form.addEventListener('submit', aoEnviarFormulario);
  form.addEventListener('change', () => { if ($('.is-invalid', form)) mostrarErros(validar(lerPreferencias()).filter(er => $(`#campo-${er.campo}`).classList.contains('is-invalid'))); });
  form.addEventListener('reset', () => {
    // Correção (revisão de código): antes as escolhas limpas voltavam ao recarregar a página
    Store.salvarPrefs(null);
    setTimeout(() => { mostrarErros([]); marcarEtapa(1); }, 0);
    toast('Escolhas limpas');
  });
  $('#btn-surpresa').addEventListener('click', surpreender);
  $('#btn-outras').addEventListener('click', () => gerarRecomendacoes(estado.prefsAtuais));

  // Assistir junto
  const formJ = $('#form-juntos');
  formJ.addEventListener('submit', aoEnviarJuntos);
  formJ.addEventListener('input', e => { if (e.target.id.endsWith('-nome')) atualizarNomesJuntos(); });
  formJ.addEventListener('change', () => {
    if ($('.is-invalid', formJ)) mostrarErrosJuntos(validarJuntos(lerJuntos()).filter(er => $(`#campo-${er.campo}`).classList.contains('is-invalid')));
  });
  formJ.addEventListener('reset', () => {
    Store.salvarJuntos(null);
    setTimeout(() => { mostrarErrosJuntos([]); atualizarNomesJuntos(); }, 0);
    toast('Escolhas limpas');
  });
  $('#btn-outras-juntos').addEventListener('click', () => gerarJuntos(estado.juntos.prefs));

  // Topo
  $('#btn-tema').addEventListener('click', alternarTema);
  $('#cfg-atalhos').checked = Store.getAtalhos();
  $('#cfg-atalhos').addEventListener('change', e => {
    Store.salvarAtalhos(e.target.checked);
    toast(e.target.checked ? '⌨️ Atalhos de teclado ligados' : '⌨️ Atalhos de uma tecla desligados');
  });
  $('#btn-ajuda').addEventListener('click', () => abrirModal('dlg-ajuda'));
  $('#btn-perfil').addEventListener('click', () => { renderPerfis(); abrirModal('dlg-perfis'); });
  $('#form-perfil').addEventListener('submit', criarPerfil);

  // Explorar
  $('#busca').addEventListener('input', debounce(renderExplorar, 200));
  ['#filtro-genero', '#filtro-tipo', '#ordem-busca'].forEach(s => $(s).addEventListener('change', renderExplorar));

  // Favoritos e histórico
  $('#ordem-favoritos').addEventListener('change', renderFavoritos);
  $('#btn-exportar').addEventListener('click', exportarBackup);
  $('#input-importar').addEventListener('change', e => { if (e.target.files[0]) importarBackup(e.target.files[0]); e.target.value = ''; });
  $('#btn-limpar-historico').addEventListener('click', limparHistorico);

  // API
  $('#btn-api-salvar').addEventListener('click', salvarApi);
  $('#btn-api-remover').addEventListener('click', removerApi);
  $('#form-api').addEventListener('submit', e => { e.preventDefault(); salvarApi(); });

  // Modais: fechar clicando fora e devolver o foco ao botão que abriu
  $$('dialog').forEach(dlg => {
    dlg.addEventListener('click', e => { if (e.target === dlg) fecharModal(dlg); });
    dlg.addEventListener('close', () => { if (estado.ultimoFoco && document.contains(estado.ultimoFoco)) estado.ultimoFoco.focus({ preventScroll: true }); });
  });
}

/* ================================================================
   9. INICIALIZAÇÃO
   ================================================================ */
/** Roda uma etapa da inicialização sem deixar um erro derrubar as outras. */
function etapaSegura(nome, fn) {
  try { fn(); } catch (erro) { console.warn(`[CineMatch] Falha ao iniciar: ${nome}`, erro); }
}

function iniciar() {
  montarFormulario();
  montarFormularioJuntos();
  registrarEventos(); // logo depois de montar: os botões e as abas funcionam mesmo se algo abaixo falhar
  etapaSegura('tema', () => aplicarTema(document.documentElement.getAttribute('data-theme') || 'light'));
  etapaSegura('perfil', atualizarPerfilNoTopo);
  etapaSegura('favoritos', atualizarBadge);
  etapaSegura('preferências', () => preencherFormulario(prefsSalvas())); // reconhecer em vez de lembrar
  etapaSegura('assistir junto', () => preencherJuntos(juntosSalvos()));
  etapaSegura('tela inicial', () => mostrarView(location.hash.slice(1), false));
}

// Só inicia a interface na página do app (a página testes.html carrega este arquivo só para testar as funções)
document.addEventListener('DOMContentLoaded', () => { if (document.getElementById('form-prefs')) iniciar(); });
