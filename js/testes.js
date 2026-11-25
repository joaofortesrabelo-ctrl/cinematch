/**
 * testes.js — Testes automáticos do sistema de recomendação do CineMatch
 * ----------------------------------------------------------------
 * Abra o arquivo testes.html no navegador: cada teste aparece com ✅ ou ❌.
 * Não usa biblioteca nenhuma: um mini "framework" de testes está aqui embaixo.
 *
 * Os testes não mexem nos dados salvos do app (nada é gravado no LocalStorage).
 * Para os testes de pontuação darem sempre o mesmo resultado, o sorteio
 * (Math.random) é trocado por zero enquanto o teste roda.
 */

/* ---------------- Mini framework de testes ---------------- */
const resultados = [];
let grupoAtual = '';

function grupo(nome) { grupoAtual = nome; }

function teste(nome, fn) {
  const randomOriginal = Math.random;
  try {
    fn();
    resultados.push({ grupo: grupoAtual, nome, ok: true });
  } catch (erro) {
    resultados.push({ grupo: grupoAtual, nome, ok: false, erro: erro.message });
  } finally {
    Math.random = randomOriginal;
  }
}

function afirmar(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem || 'condição falsa');
}

function igual(obtido, esperado, mensagem) {
  if (obtido !== esperado) throw new Error(`${mensagem ? mensagem + ': ' : ''}esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`);
}

function perto(obtido, esperado, mensagem, tolerancia = 0.001) {
  if (Math.abs(obtido - esperado) > tolerancia) throw new Error(`${mensagem ? mensagem + ': ' : ''}esperado ${esperado}, obtido ${obtido}`);
}

/** Sem sorteio: os pontos ficam previsíveis. */
const semSorteio = () => { Math.random = () => 0; };

/* ---------------- Dados auxiliares ---------------- */
const PREFS_EXEMPLO = { tipo: 'todos', generos: ['Ficção Científica', 'Aventura'], humor: 'animado', tempo: '120', faixa: '14' };
const titulo = id => CATALOGO.find(t => t.id === id);

/** Gera preferências aleatórias (para os testes de "propriedade", que rodam centenas de combinações). */
function prefsAleatorias() {
  const sorteia = lista => lista[Math.floor(Math.random() * lista.length)];
  const qtd = 1 + Math.floor(Math.random() * 3);
  const generos = [...GENEROS].sort(() => Math.random() - 0.5).slice(0, qtd).map(g => g.id);
  return {
    tipo: sorteia(['todos', 'filme', 'serie']),
    generos,
    humor: sorteia(HUMORES).id,
    tempo: sorteia(TEMPOS).id,
    faixa: sorteia(FAIXAS).id
  };
}

/* ================================================================
   1. FILTROS OBRIGATÓRIOS
   ================================================================ */
grupo('1. Filtros obrigatórios');

teste('Nunca recomenda título acima da faixa etária (500 combinações)', () => {
  for (let i = 0; i < 500; i++) {
    const p = prefsAleatorias();
    const max = FAIXAS.find(f => f.id === p.faixa).max;
    recomendar(p).forEach(r => afirmar(r.titulo.classificacao <= max,
      `${r.titulo.titulo} (${r.titulo.classificacao}) apareceu para a faixa ${p.faixa}`));
  }
});

teste('Respeita o tipo: só filmes ou só séries (500 combinações)', () => {
  for (let i = 0; i < 500; i++) {
    const p = prefsAleatorias();
    if (p.tipo === 'todos') continue;
    recomendar(p).forEach(r => igual(r.titulo.tipo, p.tipo, r.titulo.titulo));
  }
});

teste('Para crianças (Livre) só aparecem títulos de classificação L', () => {
  const recs = recomendar({ ...PREFS_EXEMPLO, faixa: '0' });
  afirmar(recs.length > 0, 'nenhuma recomendação');
  recs.forEach(r => igual(r.titulo.classificacao, 0, r.titulo.titulo));
});

teste('Não recomenda títulos da lista de exclusão', () => {
  const excluir = ['de-volta-futuro', 'star-wars-4', 'stranger-things'];
  recomendar(PREFS_EXEMPLO, excluir).forEach(r => afirmar(!excluir.includes(r.titulo.id), `${r.titulo.id} estava excluído`));
});

/* ================================================================
   2. PONTUAÇÃO
   ================================================================ */
grupo('2. Pontuação');

teste('+30 pontos por gênero em comum', () => {
  semSorteio();
  const t = titulo('de-volta-futuro'); // Ficção Científica, Comédia, Aventura
  const um = pontuar(t, { ...PREFS_EXEMPLO, generos: ['Ficção Científica'] }).pontos;
  const dois = pontuar(t, { ...PREFS_EXEMPLO, generos: ['Ficção Científica', 'Aventura'] }).pontos;
  perto(dois - um, 30, 'diferença entre 1 e 2 gêneros');
});

teste('+25 pontos quando combina com o humor', () => {
  semSorteio();
  const t = titulo('de-volta-futuro'); // humores: animado, rir, relaxado
  const combina = pontuar(t, { ...PREFS_EXEMPLO, humor: 'animado' }).pontos;
  const naoCombina = pontuar(t, { ...PREFS_EXEMPLO, humor: 'triste' }).pontos;
  perto(combina - naoCombina, 25, 'diferença com e sem humor');
});

teste('A nota do público vale nota × 4', () => {
  semSorteio();
  const t = titulo('de-volta-futuro');
  const base = pontuar(t, PREFS_EXEMPLO).pontos;
  const notaMaior = pontuar({ ...t, nota: t.nota + 1 }, PREFS_EXEMPLO).pontos;
  perto(notaMaior - base, 4, '1 ponto de nota');
});

teste('Passar muito do tempo tira 60 pontos', () => {
  semSorteio();
  const t = titulo('interestelar'); // 169 min
  const comTempo = pontuar(t, { ...PREFS_EXEMPLO, tempo: '180' }).pontos;
  const semTempo = pontuar(t, { ...PREFS_EXEMPLO, tempo: '120' }).pontos;
  perto(comTempo - semTempo, 60, 'penalidade');
});

teste('Passar até 15 minutos tira só 12 pontos (tolerância)', () => {
  semSorteio();
  const t = titulo('star-wars-4'); // 121 min, limite de 120
  const r = pontuar(t, PREFS_EXEMPLO);
  const semLimite = pontuar(t, { ...PREFS_EXEMPLO, tempo: 'livre' });
  perto(semLimite.pontos - r.pontos, 12, 'penalidade reduzida');
  afirmar(r.motivos.some(m => m.texto.includes('pouquinho')), 'motivo "passa só um pouquinho" ausente');
});

teste('Séries comparam o tempo com a duração de um episódio', () => {
  const r = pontuar(titulo('friends'), { ...PREFS_EXEMPLO, tempo: '90' }); // 22 min/ep
  afirmar(r.cabe, 'episódio de 22 min deveria caber em 1h30');
  afirmar(r.motivos.some(m => m.texto === 'Episódios cabem no seu tempo'), 'motivo de série ausente');
});

teste('O sorteio soma no máximo 10 pontos', () => {
  const t = titulo('matrix');
  Math.random = () => 0;
  const minimo = pontuar(t, PREFS_EXEMPLO).pontos;
  Math.random = () => 0.9999;
  const maximo = pontuar(t, PREFS_EXEMPLO).pontos;
  afirmar(maximo - minimo < 10 && maximo - minimo > 9.9, `variação de ${maximo - minimo}`);
});

teste('A % de compatibilidade fica sempre entre 35% e 99%', () => {
  for (let i = 0; i < 300; i++) {
    const p = prefsAleatorias();
    CATALOGO.forEach(t => {
      const { pct } = pontuar(t, p);
      afirmar(pct >= 35 && pct <= 99, `${t.titulo}: ${pct}%`);
    });
  }
});

/* ================================================================
   3. EXEMPLO DO RELATÓRIO (seção 6)
   ================================================================ */
grupo('3. Exemplo do relatório');

teste('De Volta para o Futuro: 119 pontos e 99%', () => {
  semSorteio();
  const r = pontuar(titulo('de-volta-futuro'), PREFS_EXEMPLO);
  perto(r.pontos, 119, 'pontos');
  igual(r.pct, 99, 'compatibilidade');
});

teste('Star Wars: 107,4 pontos e 93%', () => {
  semSorteio();
  const r = pontuar(titulo('star-wars-4'), PREFS_EXEMPLO);
  perto(r.pontos, 107.4, 'pontos');
  igual(r.pct, 93, 'compatibilidade');
});

teste('Interestelar: 34,8 pontos e fica fora das 3 sugestões', () => {
  semSorteio();
  perto(pontuar(titulo('interestelar'), PREFS_EXEMPLO).pontos, 34.8, 'pontos');
  const ids = recomendar(PREFS_EXEMPLO).map(r => r.titulo.id);
  afirmar(!ids.includes('interestelar'), 'Interestelar apareceu');
});

/* ================================================================
   4. ESCOLHA DOS 3 MELHORES
   ================================================================ */
grupo('4. Escolha dos 3 melhores');

teste('Devolve no máximo 3 títulos, sem repetir (500 combinações)', () => {
  for (let i = 0; i < 500; i++) {
    const recs = recomendar(prefsAleatorias());
    afirmar(recs.length <= 3, `${recs.length} sugestões`);
    igual(new Set(recs.map(r => r.titulo.id)).size, recs.length, 'títulos repetidos');
  }
});

teste('Os títulos que combinam vêm em ordem de pontos', () => {
  semSorteio();
  const recs = recomendar(PREFS_EXEMPLO).filter(r => r.relevante);
  for (let i = 1; i < recs.length; i++) afirmar(recs[i - 1].pontos >= recs[i].pontos, 'fora de ordem');
});

teste('Com "Tanto faz" e qualquer faixa, sempre há 3 sugestões', () => {
  FAIXAS.forEach(f => {
    for (let i = 0; i < 50; i++) {
      const p = { ...prefsAleatorias(), tipo: 'todos', faixa: f.id };
      igual(recomendar(p).length, 3, `faixa ${f.label}`);
    }
  });
});

teste('Sem opções que combinem, completa com as mais bem avaliadas e avisa', () => {
  // Criança + série + terror: nenhuma série livre é de terror ou "tensa"
  const recs = recomendar({ tipo: 'serie', generos: ['Terror'], humor: 'tenso', tempo: '90', faixa: '0' });
  afirmar(recs.length > 0, 'nenhuma sugestão');
  recs.forEach(r => afirmar(r.motivos.some(m => m.texto === 'Sugestão bem avaliada pelo público'), `${r.titulo.titulo} sem o aviso`));
});

teste('Cada sugestão traz pelo menos um motivo', () => {
  for (let i = 0; i < 200; i++) recomendar(prefsAleatorias()).forEach(r => afirmar(r.motivos.length > 0, `${r.titulo.titulo} sem motivo`));
});

/* ================================================================
   5. "OUTRAS SUGESTÕES" E "TROCAR"
   ================================================================ */
grupo('5. Outras sugestões e Trocar');

teste('Rodadas seguidas não repetem títulos até esgotar as opções', () => {
  const vistos = [];
  const total = totalDisponivel(PREFS_EXEMPLO);
  while (total - vistos.length >= 3) {
    const recs = recomendar(PREFS_EXEMPLO, vistos);
    recs.forEach(r => afirmar(!vistos.includes(r.titulo.id), `${r.titulo.titulo} repetido`));
    vistos.push(...recs.map(r => r.titulo.id));
  }
  afirmar(vistos.length >= total - 2, 'parou antes de esgotar');
});

teste('Trocar pede 1 título novo, diferente dos que estão na tela', () => {
  const naTela = recomendar(PREFS_EXEMPLO).map(r => r.titulo.id);
  const novo = recomendar(PREFS_EXEMPLO, naTela, 1);
  igual(novo.length, 1, 'quantidade');
  afirmar(!naTela.includes(novo[0].titulo.id), 'repetiu um título da tela');
});

teste('totalDisponivel conta só o que passa nos filtros', () => {
  const p = { ...PREFS_EXEMPLO, tipo: 'serie', faixa: '0' };
  igual(totalDisponivel(p), CATALOGO.filter(t => t.tipo === 'serie' && t.classificacao === 0).length);
});

/* ================================================================
   6. VALIDAÇÃO E FUNÇÕES DE APOIO
   ================================================================ */
grupo('6. Validação e funções de apoio');

teste('Formulário vazio gera os 4 erros obrigatórios', () => {
  const erros = validar({ tipo: 'todos', generos: [], humor: '', tempo: '', faixa: '' });
  igual(erros.map(e => e.campo).join(','), 'genero,humor,tempo,faixa');
});

teste('Formulário completo não tem erros', () => {
  igual(validar(PREFS_EXEMPLO).length, 0);
});

teste('formatarDuracao: 169 → 2h49min, 45 → 45min, 120 → 2h', () => {
  igual(formatarDuracao(169), '2h49min');
  igual(formatarDuracao(45), '45min');
  igual(formatarDuracao(120), '2h');
});

teste('normalizar tira acentos ("Ação" → "acao")', () => {
  igual(normalizar('Ação'), 'acao');
  igual(normalizar('Ficção Científica'), 'ficcao cientifica');
});

teste('limparBackup descarta itens inválidos e notas fora de 0 a 5', () => {
  const d = limparBackup({ app: 'CineMatch', favoritos: [null, 'x', { id: 'dark', minhaNota: 9 }, { id: 'dark' }, { id: 'nao-existe' }, { id: 'friends', minhaNota: 4 }] });
  igual(d.favoritos.map(f => `${f.id}:${f.minhaNota}`).join(','), 'dark:0,friends:4');
  igual(d.ignorados, 4);
});

teste('O catálogo é consistente (ids únicos, gêneros e humores válidos)', () => {
  igual(new Set(CATALOGO.map(t => t.id)).size, CATALOGO.length, 'ids repetidos');
  CATALOGO.forEach(t => {
    t.generos.forEach(g => afirmar(GENEROS.some(x => x.id === g), `${t.id}: gênero ${g}`));
    t.humores.forEach(h => afirmar(HUMORES.some(x => x.id === h), `${t.id}: humor ${h}`));
    afirmar([0, 10, 12, 14, 16, 18].includes(t.classificacao), `${t.id}: classificação ${t.classificacao}`);
    afirmar(t.nota > 0 && t.nota <= 10, `${t.id}: nota ${t.nota}`);
  });
});

/* ================================================================
   7. MODO "ASSISTIR JUNTO"
   ================================================================ */
grupo('7. Assistir junto');

const JUNTOS_EXEMPLO = {
  comum: { tipo: 'todos', tempo: '120' },
  a: { nome: 'Ana', generos: ['Comédia', 'Animação'], humor: 'rir', faixa: '18' },
  b: { nome: 'Pedro', generos: ['Ação', 'Comédia'], humor: 'animado', faixa: '12' }
};
/** Duas pessoas aleatórias (tipo e tempo em comum). */
function juntosAleatorio() {
  const pa = prefsAleatorias(), pb = prefsAleatorias();
  return {
    comum: { tipo: pa.tipo, tempo: pa.tempo },
    a: { nome: 'A', generos: pa.generos, humor: pa.humor, faixa: pa.faixa },
    b: { nome: 'B', generos: pb.generos, humor: pb.humor, faixa: pb.faixa }
  };
}
const maxFaixa = id => FAIXAS.find(f => f.id === id).max;

teste('Vale a faixa etária de quem é mais novo (500 combinações)', () => {
  for (let i = 0; i < 500; i++) {
    const j = juntosAleatorio();
    const max = Math.min(maxFaixa(j.a.faixa), maxFaixa(j.b.faixa));
    recomendarJuntos(j).forEach(r => afirmar(r.titulo.classificacao <= max,
      `${r.titulo.titulo} (${r.titulo.classificacao}) apareceu com faixas ${j.a.faixa} e ${j.b.faixa}`));
  }
});

teste('Respeita o tipo escolhido pelos dois (500 combinações)', () => {
  for (let i = 0; i < 500; i++) {
    const j = juntosAleatorio();
    if (j.comum.tipo === 'todos') continue;
    recomendarJuntos(j).forEach(r => igual(r.titulo.tipo, j.comum.tipo, r.titulo.titulo));
  }
});

teste('Pontos do par = a menor das duas pontuações', () => {
  semSorteio();
  const t = titulo('toy-story'); // Ana e Pedro pontuam diferente aqui (se fossem iguais, o teste não provaria nada)
  const pa = pontuar(t, prefsDaPessoa(JUNTOS_EXEMPLO.a, JUNTOS_EXEMPLO.comum));
  const pb = pontuar(t, prefsDaPessoa(JUNTOS_EXEMPLO.b, JUNTOS_EXEMPLO.comum));
  const par = pontuarJuntos(t, JUNTOS_EXEMPLO);
  perto(par.pontos, Math.min(pa.pontos, pb.pontos), 'pontos');
  perto(par.soma, pa.pontos + pb.pontos, 'soma (desempate)');
});

teste('Ordena pela pessoa menos satisfeita: ninguém fica de fora', () => {
  semSorteio();
  const menor = t => Math.min(
    pontuar(t, prefsDaPessoa(JUNTOS_EXEMPLO.a, JUNTOS_EXEMPLO.comum)).pontos,
    pontuar(t, prefsDaPessoa(JUNTOS_EXEMPLO.b, JUNTOS_EXEMPLO.comum)).pontos);
  const recs = recomendarJuntos(JUNTOS_EXEMPLO, [], 6);
  for (let i = 1; i < recs.length; i++) {
    afirmar(menor(recs[i - 1].titulo) >= menor(recs[i].titulo),
      `${recs[i - 1].titulo.titulo} veio antes de ${recs[i].titulo.titulo}, mas deixa alguém menos satisfeito`);
  }
});

teste('% do par = a menor %, e cada pessoa tem a sua', () => {
  semSorteio();
  const par = pontuarJuntos(titulo('toy-story'), JUNTOS_EXEMPLO);
  igual(par.pessoas[0].nome, 'Ana'); igual(par.pessoas[1].nome, 'Pedro');
  igual(par.pct, Math.min(par.pessoas[0].pct, par.pessoas[1].pct));
  afirmar(par.pessoas[0].pct > par.pessoas[1].pct, 'Toy Story deveria agradar mais a Ana (Animação + Comédia)');
});

teste('Prefere títulos que agradam os dois (500 combinações)', () => {
  for (let i = 0; i < 500; i++) {
    const j = juntosAleatorio();
    const faixa = Math.min(maxFaixa(j.a.faixa), maxFaixa(j.b.faixa));
    const possiveis = CATALOGO.filter(t => t.classificacao <= faixa && (j.comum.tipo === 'todos' || t.tipo === j.comum.tipo))
      .filter(t => pontuarJuntos(t, j).agradaAmbos).length;
    const recs = recomendarJuntos(j);
    const quantos = recs.filter(r => r.agradaAmbos).length;
    igual(quantos, Math.min(3, possiveis), 'títulos que agradam os dois');
  }
});

teste('A ordem das pessoas não muda o resultado', () => {
  semSorteio();
  const invertido = { comum: JUNTOS_EXEMPLO.comum, a: JUNTOS_EXEMPLO.b, b: JUNTOS_EXEMPLO.a };
  igual(recomendarJuntos(invertido).map(r => r.titulo.id).join(), recomendarJuntos(JUNTOS_EXEMPLO).map(r => r.titulo.id).join());
});

teste('Gostos opostos: ainda vêm 3 títulos, sem repetir, explicando para quem é', () => {
  const j = {
    comum: { tipo: 'filme', tempo: 'livre' },
    a: { nome: 'A', generos: ['Terror'], humor: 'tenso', faixa: '18' },
    b: { nome: 'B', generos: ['Musical'], humor: 'romantico', faixa: '18' }
  };
  const recs = recomendarJuntos(j);
  igual(recs.length, 3);
  igual(new Set(recs.map(r => r.titulo.id)).size, 3, 'repetiu título');
  recs.filter(r => !r.agradaAmbos).forEach(r =>
    afirmar(r.motivos.some(m => m.icone === '⚖️' || m.icone === '⭐'), `${r.titulo.titulo} sem motivo de "agrada mais a"`));
});

teste('Motivos usam o nome de cada um ("Pessoa 1" se ficar em branco)', () => {
  semSorteio();
  const textos = pontuarJuntos(titulo('os-incriveis'), JUNTOS_EXEMPLO).motivos.map(m => m.texto);
  afirmar(textos.includes('Ana curte Animação'), textos.join(' | '));
  afirmar(textos.includes('Pedro curte Ação'), textos.join(' | '));
  afirmar(textos.some(t => t.includes('tempo de vocês')), 'motivo do tempo no plural');
  igual(nomeDaPessoa({ nome: '  ' }, 2), 'Pessoa 2');
});

teste('Validação aponta o campo e o nome de quem faltou', () => {
  const vazio = { comum: { tipo: 'todos', tempo: '' }, a: { nome: 'Ana', generos: [], humor: '', faixa: '' }, b: { nome: '', generos: [], humor: '', faixa: '' } };
  const erros = validarJuntos(vazio);
  igual(erros.length, 7);
  igual(erros[0].campo, 'j-tempo', 'primeiro erro (de cima para baixo)');
  afirmar(erros.find(e => e.campo === 'j-a-genero').msg.includes('Ana'));
  afirmar(erros.find(e => e.campo === 'j-b-humor').msg.includes('Pessoa 2'));
  igual(validarJuntos(JUNTOS_EXEMPLO).length, 0, 'exemplo completo');
});

teste('Backup aceita histórico do modo juntos e descarta o inválido', () => {
  const agora = new Date().toISOString();
  const d = limparBackup({ app: 'CineMatch', favoritos: [], historico: [
    { id: 1, quando: agora, ids: ['toy-story'], prefs: { modo: 'juntos', ...JUNTOS_EXEMPLO } },
    { id: 2, quando: agora, ids: [], prefs: { modo: 'juntos', comum: { tipo: 'todos', tempo: '120' }, a: JUNTOS_EXEMPLO.a } }
  ] });
  igual(d.historico.length, 1);
  igual(d.ignorados, 1);
});

/* ---------------- Mostra o resultado na página ---------------- */
function mostrarResultados() {
  const ok = resultados.filter(r => r.ok).length;
  const falhas = resultados.length - ok;
  const resumo = document.getElementById('resumo');
  resumo.textContent = falhas ? `❌ ${falhas} de ${resultados.length} testes falharam` : `✅ Todos os ${resultados.length} testes passaram`;
  resumo.className = falhas ? 'resumo falhou' : 'resumo passou';
  const grupos = [...new Set(resultados.map(r => r.grupo))];
  document.getElementById('lista').innerHTML = grupos.map(g => `
    <section><h2>${g}</h2><ul>
      ${resultados.filter(r => r.grupo === g).map(r => `<li class="${r.ok ? 'ok' : 'erro'}">${r.ok ? '✅' : '❌'} ${r.nome}${r.ok ? '' : `<br><small>${r.erro.replace(/</g, '&lt;')}</small>`}</li>`).join('')}
    </ul></section>`).join('');
  window.__resultadoTestes = { total: resultados.length, ok, falhas, resultados }; // usado em testes automatizados pelo terminal
}

document.addEventListener('DOMContentLoaded', mostrarResultados);
