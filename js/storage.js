/**
 * storage.js — Camada de persistência do CineMatch (LocalStorage)
 * ----------------------------------------------------------------
 * Toda leitura/escrita no LocalStorage passa por aqui. Assim:
 *  - o resto do código não precisa saber os nomes das chaves;
 *  - erros (modo anônimo, cota cheia, JSON corrompido) são tratados
 *    num lugar só, e o app continua funcionando sem travar.
 *
 * Os dados são separados POR PERFIL: cada perfil tem seus próprios
 * favoritos, histórico e preferências. Tema, perfis e a chave da API
 * são globais.
 *
 * Chaves usadas (todas com o prefixo "cinematch:"):
 *   tema ................. 'light' | 'dark'
 *   atalhos .............. true | false (atalhos de uma tecla ligados?)
 *   perfis ............... [{ id, nome, avatar }]
 *   perfilAtivo .......... id do perfil em uso
 *   <perfil>:favoritos ... [{ id, adicionadoEm, minhaNota }]
 *   <perfil>:historico ... [{ id, quando, prefs, ids[] }]  (no modo juntos, prefs = { modo: 'juntos', comum, a, b })
 *   <perfil>:prefs ....... últimas preferências usadas no formulário
 *   <perfil>:juntos ...... últimas escolhas do modo "Assistir junto" { comum, a, b }
 *   tmdbKey .............. chave da API TMDb (opcional)
 *   tmdbCache ............ { [idTitulo]: { poster, sinopse, nota } }
 */

const Store = (() => {
  const PREFIX = 'cinematch:';
  const LIMITE_HISTORICO = 30;
  const PERFIL_PADRAO = { id: 'p1', nome: 'Eu', avatar: '🍿' };

  /* ---------- Funções base (com tratamento de erro) ---------- */
  function ler(chave, padrao) {
    try {
      const bruto = localStorage.getItem(PREFIX + chave);
      return bruto === null ? padrao : JSON.parse(bruto);
    } catch (erro) {
      console.warn('[CineMatch] Não foi possível ler', chave, erro);
      return padrao;
    }
  }

  function gravar(chave, valor) {
    try {
      localStorage.setItem(PREFIX + chave, JSON.stringify(valor));
      return true;
    } catch (erro) {
      console.warn('[CineMatch] Não foi possível salvar', chave, erro);
      return false;
    }
  }

  function apagar(chave) {
    try { localStorage.removeItem(PREFIX + chave); } catch (_) { /* ignora */ }
  }

  /* ---------- Perfis ---------- */
  function getPerfis() {
    const perfis = ler('perfis', null);
    return Array.isArray(perfis) && perfis.length ? perfis : [PERFIL_PADRAO];
  }

  function salvarPerfis(perfis) { return gravar('perfis', perfis); }

  function getPerfilAtivo() {
    const id = ler('perfilAtivo', PERFIL_PADRAO.id);
    const perfis = getPerfis();
    return perfis.find(p => p.id === id) || perfis[0];
  }

  function setPerfilAtivo(id) { return gravar('perfilAtivo', id); }

  function criarPerfil(nome, avatar) {
    const perfis = getPerfis();
    const novo = { id: 'p' + Date.now(), nome: nome.trim().slice(0, 20), avatar };
    perfis.push(novo);
    salvarPerfis(perfis);
    return novo;
  }

  function excluirPerfil(id) {
    const perfis = getPerfis().filter(p => p.id !== id);
    if (!perfis.length) return false; // nunca deixa o app sem perfil
    salvarPerfis(perfis);
    ['favoritos', 'historico', 'prefs', 'juntos'].forEach(k => apagar(`${id}:${k}`));
    if (getPerfilAtivo().id === id || ler('perfilAtivo') === id) setPerfilAtivo(perfis[0].id);
    return true;
  }

  /** Monta a chave de um dado do perfil ativo. Ex.: "p1:favoritos" */
  const chavePerfil = nome => `${getPerfilAtivo().id}:${nome}`;

  /* ---------- Favoritos ---------- */
  /** Só devolve favoritos bem formados (protege contra dados antigos ou editados à mão). */
  function getFavoritos() {
    const lista = ler(chavePerfil('favoritos'), []);
    return Array.isArray(lista) ? lista.filter(f => f && typeof f === 'object' && typeof f.id === 'string') : [];
  }
  function salvarFavoritos(lista) { return gravar(chavePerfil('favoritos'), lista); }
  function isFavorito(id) { return getFavoritos().some(f => f.id === id); }

  function adicionarFavorito(id, dadosAnteriores) {
    const lista = getFavoritos();
    if (lista.some(f => f.id === id)) return lista;
    // dadosAnteriores permite "Desfazer" uma remoção mantendo a avaliação
    lista.unshift(dadosAnteriores || { id, adicionadoEm: new Date().toISOString(), minhaNota: 0 });
    salvarFavoritos(lista);
    return lista;
  }

  /** Remove e devolve o item removido (usado no botão "Desfazer"). */
  function removerFavorito(id) {
    const lista = getFavoritos();
    const item = lista.find(f => f.id === id) || null;
    salvarFavoritos(lista.filter(f => f.id !== id));
    return item;
  }

  function avaliarFavorito(id, nota) {
    const lista = getFavoritos().map(f => (f.id === id ? { ...f, minhaNota: nota } : f));
    salvarFavoritos(lista);
  }

  /* ---------- Histórico ---------- */
  function getHistorico() {
    const lista = ler(chavePerfil('historico'), []);
    return Array.isArray(lista) ? lista.filter(h => h && h.prefs && Array.isArray(h.ids)) : [];
  }

  function adicionarHistorico(prefs, ids) {
    const entrada = { id: Date.now(), quando: new Date().toISOString(), prefs, ids };
    const lista = [entrada, ...getHistorico()].slice(0, LIMITE_HISTORICO);
    gravar(chavePerfil('historico'), lista);
    return entrada;
  }

  /** Atualiza os títulos da última recomendação (quando o usuário troca um card). */
  function atualizarUltimoHistorico(ids) {
    const lista = getHistorico();
    if (!lista.length) return;
    lista[0].ids = ids;
    gravar(chavePerfil('historico'), lista);
  }

  function removerHistorico(idEntrada) {
    gravar(chavePerfil('historico'), getHistorico().filter(h => h.id !== idEntrada));
  }

  function limparHistorico() { gravar(chavePerfil('historico'), []); }

  /** Usado pelo "Desfazer" ao apagar uma entrada do histórico. */
  function restaurarHistorico(lista) { gravar(chavePerfil('historico'), lista.slice(0, LIMITE_HISTORICO)); }

  /* ---------- Preferências do formulário ---------- */
  /* Dados salvos por versões antigas ou estragados são descartados, para nunca travar o app */
  const ehTexto = v => typeof v === 'string';
  const pessoaOk = p => !!p && typeof p === 'object' && Array.isArray(p.generos) && p.generos.every(ehTexto) &&
    ehTexto(p.humor) && ehTexto(p.faixa);
  function getPrefs() {
    const p = ler(chavePerfil('prefs'), null);
    return pessoaOk(p) && ehTexto(p.tipo) && ehTexto(p.tempo) ? p : null;
  }
  function salvarPrefs(prefs) { return gravar(chavePerfil('prefs'), prefs); }

  /* ---------- Modo "Assistir junto" (escolhas das duas pessoas) ---------- */
  function getJuntos() {
    const j = ler(chavePerfil('juntos'), null);
    const ok = j && typeof j === 'object' && j.comum && ehTexto(j.comum.tipo) && ehTexto(j.comum.tempo) &&
      pessoaOk(j.a) && pessoaOk(j.b) && ehTexto(j.a.nome || '') && ehTexto(j.b.nome || '');
    return ok ? j : null;
  }
  function salvarJuntos(j) { return gravar(chavePerfil('juntos'), j); }

  /* ---------- Tema ---------- */
  function getTema() { return ler('tema', null); }
  /* Atalhos de uma tecla (podem ser desligados — WCAG 2.1.4) */
  function getAtalhos() { return ler('atalhos', true); }
  function salvarAtalhos(ligado) { return gravar('atalhos', !!ligado); }
  function salvarTema(tema) { return gravar('tema', tema); }

  /* ---------- API TMDb (bônus) ---------- */
  function getTmdbKey() { return ler('tmdbKey', ''); }
  function salvarTmdbKey(chave) { return chave ? gravar('tmdbKey', chave) : apagar('tmdbKey'); }
  function getTmdbCache() { return ler('tmdbCache', {}); }
  function salvarTmdbCache(cache) { return gravar('tmdbCache', cache); }

  /* ---------- Exportar / importar backup ---------- */
  function exportar() {
    return {
      app: 'CineMatch', versao: 1, exportadoEm: new Date().toISOString(),
      perfil: getPerfilAtivo(), favoritos: getFavoritos(), historico: getHistorico()
    };
  }

  function importar(dados) {
    if (!dados || dados.app !== 'CineMatch' || !Array.isArray(dados.favoritos)) {
      throw new Error('Arquivo de backup inválido.');
    }
    salvarFavoritos(dados.favoritos);
    if (Array.isArray(dados.historico)) gravar(chavePerfil('historico'), dados.historico.slice(0, LIMITE_HISTORICO));
  }

  // API pública do módulo
  return {
    getPerfis, getPerfilAtivo, setPerfilAtivo, criarPerfil, excluirPerfil,
    getFavoritos, isFavorito, adicionarFavorito, removerFavorito, avaliarFavorito,
    getHistorico, adicionarHistorico, atualizarUltimoHistorico, removerHistorico, limparHistorico, restaurarHistorico,
    getPrefs, salvarPrefs, getJuntos, salvarJuntos, getTema, salvarTema, getAtalhos, salvarAtalhos,
    getTmdbKey, salvarTmdbKey, getTmdbCache, salvarTmdbCache,
    exportar, importar
  };
})();
