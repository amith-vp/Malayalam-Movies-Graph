let graph;
  async function loadNetworkGraph() {
    if ('DecompressionStream' in window) {
      try {
        const gz = await fetch('data/graph.json.gz', {cache:'force-cache'});
        if (gz.ok && gz.body) {
          const stream = gz.body.pipeThrough(new DecompressionStream('gzip'));
          return await new Response(stream).json();
        }
      } catch (_) {}
    }
    const response = await fetch('data/graph.json', {cache:'force-cache'});
    if (!response.ok) throw new Error(`graph.json ${response.status}`);
    return await response.json();
  }
  async function bootNetworkApp() {
    graph = await loadNetworkGraph();
  const canvas = document.getElementById('network'), ctx = canvas.getContext('2d');
  const search = document.getElementById('search'), resultSortWrap = document.getElementById('resultSortWrap'), resultSort = document.getElementById('resultSort'), layoutMode = document.getElementById('layoutMode'), semanticYMode = document.getElementById('semanticYMode'), actorColorMode = document.getElementById('actorColorMode'), movieColorMode = document.getElementById('movieColorMode'), edgeMode = document.getElementById('edgeMode'), actorOffsetX = document.getElementById('actorOffsetX'), actorOffsetXValue = document.getElementById('actorOffsetXValue'), actorOffsetY = document.getElementById('actorOffsetY'), actorOffsetYValue = document.getElementById('actorOffsetYValue'), nodeMode = document.getElementById('nodeMode'), nodeTypeMode = document.getElementById('nodeTypeMode'), minActorFilms = document.getElementById('minActorFilms'), minMovieVotes = document.getElementById('minMovieVotes'), minMovieRating = document.getElementById('minMovieRating'), hubLimit = document.getElementById('hubLimit');
  const results = document.getElementById('results'), detail = document.getElementById('detail');
  const colors = ['#58d5e8','#e65d4f','#d7b45f','#6f9df6','#9c7df0','#64c777','#d978ca','#e28f55','#56c6ad','#c5d86d','#b48cff','#e67f87'];
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const actors = graph.nodes.filter(n => n.type === 'actor');
  const movies = graph.nodes.filter(n => n.type === 'movie');
  const actorToEdges = new Map(actors.map(n => [n.id, []]));
  const movieToEdges = new Map(movies.map(n => [n.id, []]));
  function numericOrder(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 999999; }
  graph.edges.forEach((e, index) => {
    e.index = index;
    e.order = numericOrder(e.ordering);
    if (actorToEdges.has(e.source)) actorToEdges.get(e.source).push(e);
    if (movieToEdges.has(e.target)) movieToEdges.get(e.target).push(e);
  });
  const movieLead = new Map(), leadCounts = new Map();
  for (const [movieId, list] of movieToEdges) {
    const lead = [...list].sort((a, b) => a.order - b.order || a.index - b.index)[0];
    if (!lead) continue;
    lead.isMain = true;
    movieLead.set(movieId, lead.source);
    leadCounts.set(lead.source, (leadCounts.get(lead.source) || 0) + 1);
  }
  graph.edges.forEach(e => { if (!e.isMain) e.isMain = false; });
  const actorMovies = new Map(actors.map(a => [a.id, actorToEdges.get(a.id).map(e => e.target)]));
  const movieActors = new Map(movies.map(m => [m.id, movieToEdges.get(m.id).map(e => e.source)]));
  const state = { width:0,height:0,scale:1,minScale:.06,panX:0,panY:0,bounds:null,positions:new Map(),cluster:new Map(),hubs:new Set(),visibleNodes:graph.nodes,visibleEdges:graph.edges,selectedId:'',hoverId:'',drag:null,pointer:{x:0,y:0},layoutSeed:1 };
  const actorVoteScores = new Map(actors.map(a => {
    let total=0, count=0, leadTotal=0, leadCount=0;
    for(const mid of actorMovies.get(a.id) || []) {
      const m = byId.get(mid); if(!m) continue;
      const v = Math.log10(Number(m.vote_count || 0) + 1);
      total += v; count += 1;
      if(movieLead.get(mid) === a.id) { leadTotal += v; leadCount += 1; }
    }
    return [a.id, {avg: count ? total / count : 0, leadAvg: leadCount ? leadTotal / leadCount : 0}];
  }));
  const actorVoteTotals = new Map(actors.map(a => {
    let votes=0, ratingSum=0, rated=0, first=Infinity, last=-Infinity;
    for(const mid of actorMovies.get(a.id) || []) {
      const m = byId.get(mid); if(!m) continue;
      votes += Number(m.vote_count || 0);
      if(Number(m.rating || 0) > 0) { ratingSum += Number(m.rating); rated += 1; }
      if(m.year) { first = Math.min(first, Number(m.year)); last = Math.max(last, Number(m.year)); }
    }
    return [a.id, {votes, avgRating:rated ? ratingSum / rated : 0, first:Number.isFinite(first) ? first : 0, last:Number.isFinite(last) ? last : 0}];
  }));
  function esc(v){return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function shortText(v, max=54){const text=String(v??''); return text.length > max ? text.slice(0, Math.max(0, max - 1)) + '...' : text;}
  function hash(s){let h=2166136261; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0;}
  function randUnit(id,salt=0){return ((hash(id + ':' + salt) % 10000) / 10000) * 2 - 1;}
  function genres(n){return n.genres?String(n.genres).split('|').filter(Boolean):[];}
  function actorTier(n){
    if (n.type !== 'actor') return '';
    return {
      dominant:'dominant lead star',
      lead:'lead / co-lead',
      character:'major character actor',
      support:'regular supporting actor',
      smaller:'smaller filmography'
    }[actorRole(n)] || 'smaller filmography';
  }
  function meta(n){const p=[n.type==='actor'?actorTier(n):'Movie']; const g=genres(n)[0]; if(g)p.push(g); if(n.year)p.push(n.year); if(n.rating)p.push(`IMDb ${n.rating}`); if(n.type==='movie'&&n.vote_count)p.push(`${Number(n.vote_count).toLocaleString()} votes`); p.push(`${n.degree} star links`); return p.join(' / ');}
  function resultMeta(n){
    if(n.type === 'actor') return actorBrief(n, resultSort.value === 'lead');
    return movieBrief(n);
  }
  function movieBrief(n){
    const p=[];
    if(n.year) p.push(n.year);
    if(n.rating) p.push(`IMDb ${n.rating}`);
    if(n.vote_count) p.push(`${Number(n.vote_count).toLocaleString()} votes`);
    return p.join(' / ') || 'Movie';
  }
  function actorBrief(n, preferLead=false){
    const lead = leadCounts.get(n.id) || 0;
    if(preferLead) return `${Number(lead).toLocaleString()} lead movies`;
    return `${Number(n.degree || 0).toLocaleString()} movies`;
  }
  function selectedMeta(n){return n.type === 'movie' ? movieBrief(n) : actorBrief(n, resultSort.value === 'lead');}
  function imageFor(n){return n.type==='movie'?(n.tmdb_poster_url||n.poster_url):(n.tmdb_profile_url||n.profile_image);}
  function isMainLeadActor(id){return leadCounts.has(id);}
  function semanticYInfo(){
    const map = {
	      lead:['Lead prominence','actors: more main-lead and earlier-billed roles higher; movies: stronger top-billed lead structure higher'],
	      community:['Collaboration group','horizontal lanes are actor/movie collaboration communities; bridge nodes sit between lanes'],
	      starPower:['Cast star power','actors: stronger career prominence higher; movies: casts with more prominent/top-billed actors higher'],
	      volume:['Film volume / connections','actors: more star links higher; movies: larger cast/star-link count higher'],
      rating:['Rating / reception','movies: higher IMDb rating higher; actors: weighted average rating of their films higher'],
      votes:['Audience vote popularity','movies: more IMDb votes higher; actors: weighted average vote popularity of their films higher'],
      genre:['Primary genre lane','movies: primary genre lane; actors: genre they appear in most often'],
      cast:['Cast size / ensemble scale','movies: bigger credited star ensemble higher; actors: average ensemble size of their films higher'],
    };
    const item = map[semanticYMode.value] || map.lead;
    return {title:item[0], detail:item[1]};
  }
  const genreFamilyColors = {
    drama:'#76d2a6',
    comedy:'#f2cf5b',
    thriller:'#ef6f6c',
    action:'#ff9a57',
    speculative:'#8f85ff',
    factual:'#68b8f7',
    other:'#a8b3c4'
  };
  function genreFamily(n){
    const set = new Set(genres(n).map(g => g.toLowerCase()));
    if(set.has('thriller') || set.has('mystery') || set.has('crime') || set.has('horror')) return 'thriller';
    if(set.has('action') || set.has('adventure') || set.has('war') || set.has('sport')) return 'action';
    if(set.has('comedy') || set.has('musical') || set.has('music')) return 'comedy';
    if(set.has('fantasy') || set.has('sci-fi') || set.has('animation')) return 'speculative';
    if(set.has('documentary') || set.has('biography') || set.has('history') || set.has('news')) return 'factual';
    if(set.has('drama') || set.has('family') || set.has('romance')) return 'drama';
    return 'other';
  }
  function movieColor(n){
    const mode = movieColorMode.value;
    if(mode === 'cluster') return colors[(state.cluster.get(n.id)||0)%colors.length];
    if(mode === 'rating') {
      const r = Number(n.rating || 0);
      if(!r) return '#8994a4';
      if(r >= 8) return '#5be29a';
      if(r >= 7) return '#a7d96a';
      if(r >= 6) return '#f2cf5b';
      if(r >= 5) return '#f59d54';
      return '#e86b6b';
    }
    if(mode === 'votes') {
      const v = Math.log10(Number(n.vote_count || 0) + 1) / Math.log10(65000);
      if(v >= .76) return '#58d5e8';
      if(v >= .56) return '#6f9df6';
      if(v >= .36) return '#9c7df0';
      if(v >= .16) return '#d978ca';
      return '#697589';
    }
    return genreFamilyColors[genreFamily(n)] || genreFamilyColors.other;
  }
  const actorRoleColors = {
    dominant:'#ff5d7a',
    lead:'#f2b84b',
    character:'#58d5e8',
    support:'#8f85ff',
    smaller:'#9aa6b8'
  };
  function actorRole(n){
    const d = n.degree || 0;
    const lc = leadCounts.get(n.id) || 0;
    const ratio = lc / Math.max(1, d);
    const votes = actorVoteScores.get(n.id) || {avg:0, leadAvg:0};
    const visibleOldLead = votes.avg < 1.25 && votes.leadAvg >= .34;
    if(
      (lc >= 85 && ratio >= .24 && (votes.avg >= 1.25 || votes.leadAvg >= .6 || (d >= 300 && ratio <= .3 && votes.leadAvg >= .34))) ||
      (lc >= 55 && ratio >= .42) ||
      (lc >= 28 && ratio >= .52 && votes.avg >= 3.05) ||
      (lc >= 20 && ratio >= .65 && votes.avg >= 3.2) ||
      (d >= 120 && d <= 160 && lc >= 35 && ratio >= .25 && visibleOldLead)
    ) return 'dominant';
    if(
      (lc >= 25 && votes.avg >= 2.05) ||
      (lc >= 20 && d >= 180 && votes.avg >= 2.05) ||
      (lc >= 12 && ratio >= .18 && votes.avg >= 2.6) ||
      (d >= 12 && lc >= 7 && ratio >= .45) ||
      (d >= 25 && lc >= 3 && ratio >= .1 && votes.avg >= 3)
    ) return 'lead';
    if(d >= 300 || (d >= 70 && ratio <= .11) || (d >= 70 && lc <= 5) || (d >= 90 && lc >= 20 && ratio <= .24 && votes.avg >= 2.5)) return 'character';
    if(d >= 25) return 'support';
    return 'smaller';
  }
  function actorColor(n){
    if(actorColorMode.value === 'cluster') return colors[(state.cluster.get(n.id)||0)%colors.length];
    return actorRoleColors[actorRole(n)] || actorRoleColors.smaller;
  }
  function color(n){
    if(n.id===state.selectedId)return '#e9ff7f';
    if(n.type==='movie')return movieColor(n);
    return actorColor(n);
  }
  function isLowFilmActor(n){return n.type==='actor' && (n.degree || 0) < 5 && !state.hubs.has(n.id);}
  function rgba(hex,a){const n=parseInt(hex.slice(1),16); return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;}
  function radius(n){
    if(n.type==='movie') {
      const voteSize = Math.log10(Number(n.vote_count || 0) + 1) * 1.75;
      const castSize = Math.log1p(n.degree || 1) * .36;
      return Math.min(15.5, 3.15 + voteSize + castSize);
    }
    const d = n.degree || 0;
    const lc = leadCounts.get(n.id) || 0;
    const volume = Math.log1p(d) * .95 + Math.sqrt(d) * .18;
    const leadBoost = Math.log1p(lc) * .48;
    return Math.min(13, (1.9 + volume + leadBoost + (state.hubs.has(n.id) ? 1.2 : 0)) * 1.18);
  }
  function displayRadius(n){
    const spatial = layoutMode.value === 'force' || layoutMode.value === 'semantic';
    const scaleFactor = n.type === 'actor' ? Math.max(spatial ? .4 : .42, Math.sqrt(state.scale)) : Math.max(spatial ? .54 : .56, Math.sqrt(state.scale));
    const minRadius = n.type === 'actor' ? (spatial ? 1.05 : 1.15) : .95;
    const base = Math.max(minRadius, radius(n) * (spatial && n.type === 'actor' ? .96 : 1) * scaleFactor);
    return isLowFilmActor(n) ? Math.max(.55, base * .62) : base;
  }
  function shouldLabel(n, active, hasFocus){
    if(!active) return false;
    if(n.id === state.selectedId || n.id === state.hoverId) return true;
    const z = state.scale;
    if(n.type === 'movie') {
      const votes = Number(n.vote_count || 0);
      if(votes >= 18000) return z > .07;
      if(votes >= 9000) return z > .12;
      if(votes >= 4500) return z > .2;
      if(votes >= 1800) return z > .38;
      return hasFocus && votes >= 650 && z > .5;
    }
    if(isLowFilmActor(n)) return false;
    const role = actorRole(n);
    const d = n.degree || 0;
    if(role === 'dominant') return z > .065;
    if(role === 'lead') return z > .16;
    if(role === 'character') return z > .28 || (hasFocus && z > .12);
    if(role === 'support') return z > .48 || (hasFocus && d >= 80 && z > .2);
    return hasFocus && d >= 25 && z > .7;
  }
  function labelFont(n){
    if(n.id === state.selectedId || n.id === state.hoverId) return '700 13px system-ui';
    if(n.type === 'movie') return Number(n.vote_count || 0) >= 9000 ? '700 10.5px system-ui' : '650 9.5px system-ui';
    const role = actorRole(n);
    return role === 'dominant' ? '700 11px system-ui' : role === 'lead' ? '700 10px system-ui' : '650 9.5px system-ui';
  }
  function worldToScreen(p){return {x:p.x*state.scale+state.panX,y:p.y*state.scale+state.panY};}
  function screenToWorld(x,y){return {x:(x-state.panX)/state.scale,y:(y-state.panY)/state.scale};}
  function edgePass(e){return edgeMode.value==='main'?e.isMain:edgeMode.value==='supporting'?!e.isMain:true;}
  function visibleEdgeSet(){return graph.edges.filter(edgePass);}
  function nodeTypePass(n){return nodeTypeMode.value==='actors'?n.type==='actor':nodeTypeMode.value==='movies'?n.type==='movie':true;}
  function numericInput(el, fallback=0){
    const value = Number(el.value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
  function metricPass(n){
    if(n.type === 'actor') return (n.degree || 0) >= numericInput(minActorFilms);
    const votesOk = Number(n.vote_count || 0) >= numericInput(minMovieVotes);
    const minRating = numericInput(minMovieRating);
    const ratingOk = minRating <= 0 || Number(n.rating || 0) >= minRating;
    return votesOk && ratingOk;
  }
  function applyFilters(){
    const baseEdges = visibleEdgeSet();
    let ids;
    if (nodeMode.value === 'hubs') {
      const hubs = leadHubActors();
      const hubIds = new Set(hubs.map(h => h.id));
      const movieRows = movies
        .map(movie => {
          const linked = (movieActors.get(movie.id) || []).filter(id => hubIds.has(id));
          return {movie, linked, score: linked.length * 20 + Math.log1p(movie.degree || 0) * 5 + (movie.rating || 0)};
        })
        .filter(row => row.linked.length >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(48, Number(hubLimit.value) * 2));
      ids = new Set([...hubIds, ...movieRows.map(row => row.movie.id)]);
    } else if (nodeMode.value === 'connected') {
      ids = new Set();
      baseEdges.forEach(e => { ids.add(e.source); ids.add(e.target); });
    } else {
      ids = new Set(graph.nodes.map(n => n.id));
    }
    const candidateNodes = graph.nodes.filter(n => ids.has(n.id) && metricPass(n));
    const candidateIds = new Set(candidateNodes.map(n => n.id));
    const connectedEdges = baseEdges.filter(e => candidateIds.has(e.source) && candidateIds.has(e.target));
    const connectedIds = new Set();
    connectedEdges.forEach(e => { connectedIds.add(e.source); connectedIds.add(e.target); });
    state.visibleNodes = candidateNodes.filter(n => connectedIds.has(n.id) && nodeTypePass(n));
    const typedIds = new Set(state.visibleNodes.map(n => n.id));
    if (state.selectedId && !typedIds.has(state.selectedId)) state.selectedId = '';
    state.visibleEdges = nodeTypeMode.value === 'all' ? connectedEdges.filter(e => typedIds.has(e.source) && typedIds.has(e.target)) : [];
    renderResults();
    renderDetail(state.selectedId ? byId.get(state.selectedId) : null);
    fitGraph();
  }
  function related(id){
    const s = new Set(); if(!id) return s; s.add(id);
    for (const e of state.visibleEdges) { if(e.source===id)s.add(e.target); if(e.target===id)s.add(e.source); }
    return s;
  }
  function leadHubActors(){
    return actors
      .map(a => ({node:a, score:(leadCounts.get(a.id)||0)*8 + Math.log1p(a.degree||0)*3}))
      .filter(x => x.score > 0)
      .sort((a,b)=>b.score-a.score || String(a.node.label).localeCompare(String(b.node.label)))
      .slice(0, Number(hubLimit.value))
      .map(x => x.node);
  }
  function clusterLegendRows(limit=12){
    const hubs = leadHubActors().slice(0, limit);
    return hubs.map((h,i)=>`<span title="${esc(h.label)}"><i class="cluster-swatch" style="background:${colors[i%colors.length]};color:${colors[i%colors.length]}"></i>${esc(shortText(h.label, 34))}</span>`).join('');
  }
  function actorColorLegend(){
    if(actorColorMode.value === 'cluster') {
      return {label:'Actor Color: Collaboration Cluster', rows:clusterLegendRows(), hint:'Actor colors show the lead/anchor collaboration cluster they are closest to.'};
    }
    const rows = [
      [actorRoleColors.dominant,'Dominant lead star'],
      [actorRoleColors.lead,'Lead / co-lead'],
      [actorRoleColors.character,'Major character actor'],
      [actorRoleColors.support,'Regular supporting actor'],
      [actorRoleColors.smaller,'Smaller filmography']
    ].map(([c,t])=>`<span title="${esc(t)}"><i class="cluster-swatch" style="background:${c};color:${c}"></i>${esc(t)}</span>`).join('');
    return {label:'Actor Color: Career Role', rows, hint:''};
  }
  function movieColorLegend(){
    if(movieColorMode.value === 'cluster') {
      return {label:'Movie Color: Actor Cluster', rows:clusterLegendRows(), hint:'Movies inherit the color of their lead/anchor actor cluster.'};
    }
    if(movieColorMode.value === 'rating') {
      const rows = [
        ['#5be29a','IMDb 8+'], ['#a7d96a','IMDb 7-7.9'], ['#f2cf5b','IMDb 6-6.9'],
        ['#f59d54','IMDb 5-5.9'], ['#e86b6b','below 5'], ['#8994a4','unrated']
      ].map(([c,t])=>`<span title="${esc(t)}"><i class="cluster-swatch" style="background:${c};color:${c}"></i>${esc(t)}</span>`).join('');
      return {label:'Movie Color: IMDb Rating Heat', rows, hint:'Higher-rated movies move toward green; missing ratings are gray.'};
    }
    if(movieColorMode.value === 'votes') {
      const rows = [
        ['#58d5e8','very high votes'], ['#6f9df6','high votes'], ['#9c7df0','medium votes'],
        ['#d978ca','low votes'], ['#697589','very low / none']
      ].map(([c,t])=>`<span title="${esc(t)}"><i class="cluster-swatch" style="background:${c};color:${c}"></i>${esc(t)}</span>`).join('');
      return {label:'Movie Color: Vote Popularity', rows, hint:'Vote color uses a log scale so popular titles stand out without washing out smaller films.'};
    }
    const rows = [
      ['#76d2a6','Drama / family / romance'], ['#f2cf5b','Comedy / musical'], ['#ef6f6c','Thriller / crime / horror'],
      ['#ff9a57','Action / adventure'], ['#8f85ff','Fantasy / sci-fi / animation'], ['#68b8f7','Documentary / history'], ['#a8b3c4','Other / uncategorized']
    ].map(([c,t])=>`<span title="${esc(t)}"><i class="cluster-swatch movie-swatch" style="background:${c};color:${c}"></i>${esc(t)}</span>`).join('');
    return {label:'Movie Color: Genre Family', rows, hint:''};
  }
  function buildHubLayout(hubs){
    const hubIndex = new Map(hubs.map((h,i)=>[h.id,i]));
    const links = new Map();
    function addLink(a,b,w){ if(a===b || !hubIndex.has(a) || !hubIndex.has(b))return; const k=a<b?a+'|'+b:b+'|'+a; links.set(k,(links.get(k)||0)+w); }
    for (const m of movies) {
      const lead = movieLead.get(m.id);
      const list = movieToEdges.get(m.id) || [];
      for (const e of list) addLink(lead, e.source, e.isMain ? 0 : 1 + Math.log1p(m.degree||1));
    }
    const pos = new Map();
    const spread = 1280 + hubs.length * 9;
    hubs.forEach((h,i) => {
      const lead = leadCounts.get(h.id)||1;
      const era = (actorMovies.get(h.id)||[]).map(mid => byId.get(mid)?.year).filter(Boolean);
      const avgYear = era.length ? era.reduce((a,b)=>a+b,0)/era.length : 1990;
      const angle = ((avgYear - 1950) / 85) * Math.PI * 2 + randUnit(h.id,1) * .9;
      const r = Math.min(spread, 260 + Math.sqrt(i+1) * 112 + Math.log1p(lead) * 28);
      pos.set(h.id, {x:Math.cos(angle)*r + randUnit(h.id,2)*150, y:Math.sin(angle)*r + randUnit(h.id,3)*150, vx:0, vy:0});
    });
    const linkRows = [...links.entries()].map(([k,w]) => { const [a,b]=k.split('|'); return {a,b,w:Math.min(10,w)}; });
    for (let step=0; step<120; step++) {
      for (let i=0;i<hubs.length;i++) {
        const a = hubs[i], pa = pos.get(a.id);
        for (let j=i+1;j<hubs.length;j++) {
          const b = hubs[j], pb = pos.get(b.id);
          let dx = pa.x - pb.x, dy = pa.y - pb.y, d2 = dx*dx + dy*dy + 80;
          const f = 18000 / d2;
          dx /= Math.sqrt(d2); dy /= Math.sqrt(d2);
          pa.vx += dx*f; pa.vy += dy*f; pb.vx -= dx*f; pb.vy -= dy*f;
        }
      }
      for (const l of linkRows) {
        const a=pos.get(l.a), b=pos.get(l.b); if(!a||!b)continue;
        const dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy)||1, target=320 + 34/Math.max(1,l.w);
        const f=(d-target)*.00135*l.w;
        a.vx += dx/d*f; a.vy += dy/d*f; b.vx -= dx/d*f; b.vy -= dy/d*f;
      }
      for (const h of hubs) {
        const p=pos.get(h.id); p.vx += -p.x*.00045; p.vy += -p.y*.00045; p.x += p.vx; p.y += p.vy; p.vx*=.84; p.vy*=.84;
      }
    }
    return pos;
  }
  function assignClusters(hubs, hubPos){
    state.cluster.clear(); state.hubs = new Set(hubs.map(h=>h.id));
    hubs.forEach((h,i)=>state.cluster.set(h.id,i));
    const hubIndex = new Map(hubs.map((h,i)=>[h.id,i]));
    for (const m of movies) {
      const lead = movieLead.get(m.id);
      let cluster = hubIndex.get(lead);
      if (cluster === undefined) {
        const scores = new Map();
        for (const aid of movieActors.get(m.id) || []) {
          const c = hubIndex.get(aid);
          if (c !== undefined) scores.set(c, (scores.get(c)||0) + 3);
          for (const mid of actorMovies.get(aid) || []) {
            const l = movieLead.get(mid), hc = hubIndex.get(l);
            if (hc !== undefined) scores.set(hc, (scores.get(hc)||0) + .25);
          }
        }
        cluster = scores.size ? [...scores.entries()].sort((a,b)=>b[1]-a[1])[0][0] : hash(m.id)%Math.max(1,hubs.length);
      }
      state.cluster.set(m.id, cluster);
    }
    for (const a of actors) {
      if (state.cluster.has(a.id)) continue;
      const scores = new Map();
      for (const mid of actorMovies.get(a.id) || []) {
        const c = state.cluster.get(mid);
        if (c !== undefined) scores.set(c, (scores.get(c)||0) + (movieLead.get(mid) === a.id ? 4 : 1));
      }
      state.cluster.set(a.id, scores.size ? [...scores.entries()].sort((x,y)=>y[1]-x[1])[0][0] : hash(a.id)%Math.max(1,hubs.length));
    }
  }
  function weightedCenter(ids, fallbackCluster, hubPos, weightFn){
    let x=0,y=0,w=0;
    for (const id of ids) {
      const p = state.positions.get(id) || hubPos.get(id);
      if (!p) continue;
      const ww = weightFn ? weightFn(id) : 1;
      x += p.x * ww; y += p.y * ww; w += ww;
    }
    if (w) return {x:x/w, y:y/w};
    const h = [...state.hubs][fallbackCluster % Math.max(1,state.hubs.size)];
    return hubPos.get(h) || {x:0,y:0};
  }
  function jittered(point, id, spread){
    return {x:point.x + randUnit(id,4)*spread, y:point.y + randUnit(id,5)*spread};
  }
  function layoutBands() {
    const clusterCount = Math.max(1, state.hubs.size || Number(hubLimit.value));
    const cols = Math.ceil(Math.sqrt(clusterCount * 1.35));
    const rows = Math.ceil(clusterCount / cols);
    const clusterW = 1180, clusterH = 720;
    function baseFor(c) {
      const col = c % cols, row = Math.floor(c / cols);
      return {x:(col - (cols - 1) / 2) * clusterW, y:(row - (rows - 1) / 2) * clusterH};
    }
    function bandPoint(c, index, side, id, degree=1) {
      const base = baseFor(c);
      const golden = 2.399963229728653;
      const angle = index * golden + randUnit(id, 21) * .3;
      const ring = 18 + Math.sqrt(index + 1) * 16 + Math.log1p(degree || 1) * 4;
      const xSide = side === 'actor' ? -235 : 235;
      const xSpread = side === 'actor' ? 135 : 165;
      return {
        x: base.x + xSide + Math.cos(angle) * xSpread + randUnit(id, 22) * 26,
        y: base.y + Math.sin(angle) * ring * 1.95 + randUnit(id, 23) * 18,
      };
    }
    const actorBuckets = new Map(), movieBuckets = new Map();
    for (const a of actors) {
      const c = state.cluster.get(a.id) || 0;
      if (!actorBuckets.has(c)) actorBuckets.set(c, []);
      actorBuckets.get(c).push(a);
    }
    for (const m of movies) {
      const c = state.cluster.get(m.id) || 0;
      if (!movieBuckets.has(c)) movieBuckets.set(c, []);
      movieBuckets.get(c).push(m);
    }
    for (const [c, rows] of actorBuckets) {
      rows.sort((a,b)=>(b.degree||0)-(a.degree||0));
      rows.forEach((a, i) => state.positions.set(a.id, bandPoint(c, i, 'actor', a.id, a.degree || 1)));
    }
    for (const [c, rows] of movieBuckets) {
      rows.sort((a,b)=>(b.degree||0)-(a.degree||0));
      rows.forEach((m, i) => {
        const linkedClusters = [...new Set((movieActors.get(m.id)||[]).map(aid => state.cluster.get(aid)).filter(x => x !== undefined))];
        if (linkedClusters.length > 1) {
          let x = 0, y = 0;
          for (const item of linkedClusters) { const p = baseFor(item); x += p.x; y += p.y; }
          x /= linkedClusters.length; y /= linkedClusters.length;
          state.positions.set(m.id, {x:x + randUnit(m.id, 24) * 140, y:y + randUnit(m.id, 25) * 140});
        } else {
          state.positions.set(m.id, bandPoint(c, i, 'movie', m.id, m.degree || 1));
        }
      });
    }
  }
  function layoutForceDirected(hubPos) {
    const hubs = [...state.hubs];
    function centerForCluster(c) {
      const h = hubs[c % Math.max(1, hubs.length)];
      return hubPos.get(h) || {x:0, y:0};
    }
    const clusterCounts = new Map();
    for (const n of graph.nodes) {
      const c = state.cluster.get(n.id) || 0;
      const i = clusterCounts.get(c) || 0;
      clusterCounts.set(c, i + 1);
      const center = centerForCluster(c);
      const angle = i * 2.399963229728653 + randUnit(n.id,70) * .45;
      const base = n.type === 'movie' ? 96 : 60;
      const spread = base + Math.sqrt(i + 1) * (n.type === 'movie' ? 14 : 17) + Math.log1p(n.degree || 1) * (n.type === 'movie' ? 7 : 11);
	      state.positions.set(n.id, {
	        x:center.x + Math.cos(angle) * spread,
	        y:center.y + Math.sin(angle) * spread,
	        vx:0,
	        vy:0,
	      });
	    }
	    for (const h of hubs) {
	      const p = hubPos.get(h);
	      if (p) state.positions.set(h, {x:p.x, y:p.y, vx:0, vy:0});
	    }
    const simEdges = graph.edges.filter(e => e.isMain || e.index % 12 === 0);
    const cellSize = 72;
    const steps = 30;
    for (let step = 0; step < steps; step++) {
      const cooling = 1 - step / steps;
      const grid = new Map();
      for (const n of graph.nodes) {
        const p = state.positions.get(n.id); if (!p) continue;
        const key = Math.floor(p.x / cellSize) + ',' + Math.floor(p.y / cellSize);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(n);
      }
      for (const n of graph.nodes) {
        const p = state.positions.get(n.id); if (!p) continue;
        const gx = Math.floor(p.x / cellSize), gy = Math.floor(p.y / cellSize);
        for (let ix=-1; ix<=1; ix++) for (let iy=-1; iy<=1; iy++) {
          const bucket = grid.get((gx + ix) + ',' + (gy + iy)); if (!bucket) continue;
          for (const m of bucket) {
            if (m.id <= n.id) continue;
            const q = state.positions.get(m.id); if (!q) continue;
	            let dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || .01;
	            if (d > cellSize) continue;
	            const min = (radius(n) + radius(m)) * 4.2 + (n.type === m.type ? 12 : 18);
	            if (d < min) {
	              const push = (min - d) * .13 * cooling;
	              dx /= d; dy /= d;
	              p.vx -= dx * push; p.vy -= dy * push;
	              q.vx += dx * push; q.vy += dy * push;
	            }
	          }
	        }
	      }
      for (const e of simEdges) {
        const a = state.positions.get(e.source), b = state.positions.get(e.target);
        if (!a || !b) continue;
	        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
	        const target = e.isMain ? 96 : 132;
	        const f = (d - target) * (e.isMain ? .006 : .003) * cooling;
	        dx /= d; dy /= d;
	        a.vx += dx * f; a.vy += dy * f;
	        b.vx -= dx * f; b.vy -= dy * f;
	      }
	      for (const n of graph.nodes) {
	        const p = state.positions.get(n.id); if (!p) continue;
	        const c = state.cluster.get(n.id) || 0, center = centerForCluster(c);
	        const pull = n.type === 'movie' ? .0008 : .0013;
	        p.vx += (center.x - p.x) * pull * cooling;
	        p.vy += (center.y - p.y) * pull * cooling;
	        p.vx *= .82; p.vy *= .82;
	        p.x += p.vx; p.y += p.vy;
	      }
    }
  }
  function layoutSemanticCareer() {
    const yearRows = movies.map(m => m.year).filter(Boolean);
    const minYear = Math.min(...yearRows), maxYear = Math.max(...yearRows);
    const span = Math.max(1, maxYear - minYear);
    const clusterCount = Math.max(1, state.hubs.size || Number(hubLimit.value));
    const stats = new Map();
    for (let i = 0; i < clusterCount; i++) stats.set(i, {year:0, count:0, weight:0});
    for (const m of movies) {
      const c = state.cluster.get(m.id) || 0;
      const s = stats.get(c) || {year:0, count:0, weight:0};
      const w = 1 + Math.log1p(m.degree || 1);
      s.year += (m.year || 1990) * w;
      s.weight += w;
      s.count += 1;
      stats.set(c, s);
    }
    const lanes = [...stats.entries()]
      .map(([c,s]) => ({c, avg:s.weight ? s.year / s.weight : 1990, count:s.count}))
      .sort((a,b)=>a.avg-b.avg || b.count-a.count || a.c-b.c);
	    const laneFor = new Map(lanes.map((row,i)=>[row.c,i]));
	    function xForYear(year) { return ((year || 1990) - minYear) / span * 6200 - 3100; }
	    function yForYear(year) { return ((year || 1990) - minYear) / span * 4200 - 2100; }
	    function xForStarPower(v) { return (Math.max(0, Math.min(1, v)) - .5) * 5200; }
	    function yForCluster(c) {
      const lane = laneFor.get(c) ?? c;
      return (lane - (clusterCount - 1) / 2) * 74;
    }
    function weightedLane(ids, fallbackCluster) {
      let y = 0, w = 0;
      for (const id of ids) {
        const c = state.cluster.get(id);
        if (c === undefined) continue;
        const n = byId.get(id);
        const ww = 1 + Math.log1p(n?.degree || 1);
        y += yForCluster(c) * ww;
        w += ww;
      }
      return w ? y / w : yForCluster(fallbackCluster);
    }
    const topGenres = [...new Set(movies.flatMap(m => genres(m).slice(0,1)).filter(Boolean))].slice(0, 16);
    const genreIndex = new Map(topGenres.map((g,i)=>[g,i]));
    function genreLane(g) {
      const i = genreIndex.has(g) ? genreIndex.get(g) : topGenres.length;
      return (i - topGenres.length / 2) * 92;
    }
    function actorAverage(a, valueFn, fallback=0) {
      let total = 0, weight = 0;
      for (const mid of actorMovies.get(a.id) || []) {
        const m = byId.get(mid); if (!m) continue;
        const v = valueFn(m);
        if (!Number.isFinite(v)) continue;
        const e = (actorToEdges.get(a.id) || []).find(row => row.target === mid);
        const w = e?.isMain ? 2.4 : 1 / Math.sqrt(Math.max(1, e?.order || 8));
        total += v * w; weight += w;
      }
      return weight ? total / weight : fallback;
    }
    function actorGenre(a) {
      const counts = new Map();
      for (const mid of actorMovies.get(a.id) || []) {
        const g = genres(byId.get(mid) || {})[0];
        if (g) counts.set(g, (counts.get(g)||0)+1);
      }
      return counts.size ? [...counts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0][0] : '';
    }
    const yScale = 520;
    function movieLeadProminence(m) {
      const list = movieToEdges.get(m.id) || [];
      const leadWeighted = list.reduce((sum,e)=>sum + 1 / Math.sqrt(Math.max(1, e.order || 10)), 0);
      return Math.min(1, leadWeighted / 5.2);
    }
    function actorLeadProminence(a) {
      const total = Math.max(1, actorToEdges.get(a.id)?.length || 1);
      const main = leadCounts.get(a.id) || 0;
      const avgOrder = actorAverage(a, m => {
        const e = (actorToEdges.get(a.id) || []).find(row => row.target === m.id);
        return 1 / Math.sqrt(Math.max(1, e?.order || 12));
      }, 0);
      return Math.min(1, main / Math.max(4, total * .35) * .55 + avgOrder * .85);
    }
    const actorStarPowerRaw = new Map();
    let maxActorStarPower = 1;
    for (const a of actors) {
      const d = a.degree || 0;
      const main = leadCounts.get(a.id) || 0;
      const vote = actorVoteScores.get(a.id) || {avg:0, leadAvg:0};
      const avgBilling = actorAverage(a, m => {
        const e = (actorToEdges.get(a.id) || []).find(row => row.target === m.id);
        return 1 / Math.sqrt(Math.max(1, e?.order || 12));
      }, 0);
      const raw = Math.log1p(d) * 1.15 + Math.log1p(main) * 1.85 + avgBilling * 2.2 + vote.avg * .42 + vote.leadAvg * .58;
      actorStarPowerRaw.set(a.id, raw);
      if (raw > maxActorStarPower) maxActorStarPower = raw;
    }
    function actorStarPower(a) {
      const raw = actorStarPowerRaw.get(a.id) || 0;
      return Math.max(0, Math.min(1, raw / maxActorStarPower));
    }
    function movieStarPower(m) {
      const list = movieToEdges.get(m.id) || [];
      let total = 0, weight = 0;
      for (const e of list) {
        const actor = byId.get(e.source);
        if (!actor) continue;
        const w = e.isMain ? 3.2 : 1 / Math.sqrt(Math.max(1, e.order || 12));
        total += actorStarPower(actor) * w;
        weight += w;
      }
      const castAverage = weight ? total / weight : 0;
      const castDepth = Math.min(1, Math.log1p(list.length || 0) / Math.log1p(24));
      return Math.max(0, Math.min(1, castAverage * .82 + castDepth * .18));
    }
    function metricY(n) {
      const mode = semanticYMode.value;
      if (mode === 'community') {
        if (n.type === 'movie') return weightedLane(movieActors.get(n.id) || [], state.cluster.get(n.id) || 0);
        return weightedLane(actorMovies.get(n.id) || [], state.cluster.get(n.id) || 0);
      }
      if (mode === 'starPower') {
        const v = n.type === 'movie' ? movieStarPower(n) : actorStarPower(n);
        return (0.5 - v) * yScale * 2;
      }
      if (mode === 'lead') {
        const v = n.type === 'movie' ? movieLeadProminence(n) : actorLeadProminence(n);
        return (0.5 - v) * yScale * 2;
      }
      if (mode === 'volume') {
        const v = Math.min(1, Math.log1p(n.degree || 1) / Math.log1p(900));
        return (0.5 - v) * yScale * 2;
      }
      if (mode === 'rating') {
        const v = n.type === 'movie' ? (Number(n.rating) || 5.8) : actorAverage(n, m => Number(m.rating), 5.8);
        return (0.5 - Math.max(0, Math.min(1, (v - 3.5) / 6.5))) * yScale * 2;
      }
      if (mode === 'votes') {
        const raw = n.type === 'movie' ? Number(n.vote_count || 0) : actorAverage(n, m => Math.log1p(Number(m.vote_count || 0)), 0);
        const v = n.type === 'movie' ? Math.log1p(raw) : raw;
        return (0.5 - Math.max(0, Math.min(1, v / Math.log1p(65000)))) * yScale * 2;
      }
      if (mode === 'genre') {
        const g = n.type === 'movie' ? genres(n)[0] : actorGenre(n);
        return genreLane(g) + randUnit(n.id,86) * 12;
      }
      if (mode === 'cast') {
        const v = n.type === 'movie' ? Math.min(1, (n.degree || 0) / 30) : Math.min(1, actorAverage(n, m => Math.min(30, m.degree || 0), 8) / 30);
        return (0.5 - v) * yScale * 2;
      }
      return weightedLane(n.type === 'movie' ? (movieActors.get(n.id) || []) : (actorMovies.get(n.id) || []), state.cluster.get(n.id) || 0);
    }
	    for (const m of movies) {
	      const y = metricY(m);
	      const roleOffset = semanticYMode.value === 'community' ? ((m.degree || 0) > 14 ? -8 : 10) : 0;
	      if(semanticYMode.value === 'starPower') {
	        state.positions.set(m.id, {
	          x:xForStarPower(movieStarPower(m)) + randUnit(m.id,81) * 28,
	          y:yForYear(m.year) + randUnit(m.id,82) * 24,
	        });
	      } else {
	        state.positions.set(m.id, {
	          x:xForYear(m.year) + randUnit(m.id,81) * 24,
	          y:y + roleOffset + randUnit(m.id,82) * 20,
	        });
	      }
	    }
	    for (const a of actors) {
      const c = state.cluster.get(a.id) || 0;
      const mids = actorMovies.get(a.id) || [];
      const years = mids.map(id => byId.get(id)?.year).filter(Boolean);
      const avgYear = years.length ? years.reduce((sum, year) => sum + year, 0) / years.length : 1990;
	      const y = metricY(a);
	      const popularity = semanticYMode.value === 'community' ? Math.log1p(a.degree || 1) + Math.log1p(leadCounts.get(a.id) || 0) * 1.8 : 8;
	      const outer = semanticYMode.value === 'community' ? Math.max(0, 38 - popularity * 4.2) : 16;
	      if(semanticYMode.value === 'starPower') {
	        state.positions.set(a.id, {
	          x:xForStarPower(actorStarPower(a)) + randUnit(a.id,83) * 34,
	          y:yForYear(avgYear) - 18 + randUnit(a.id,84) * 26,
	        });
	      } else {
	        state.positions.set(a.id, {
	          x:xForYear(avgYear) + randUnit(a.id,83) * 32,
	          y:y - 18 + randUnit(a.id,84) * (18 + outer),
	        });
	      }
	    }
    relax(graph.nodes, 5, 44);
  }
  function relax(nodes, iterations, cellSize){
    for (let it=0; it<iterations; it++) {
      const grid = new Map();
      for (const n of nodes) {
        const p = state.positions.get(n.id); if(!p)continue;
        const gx=Math.floor(p.x/cellSize), gy=Math.floor(p.y/cellSize), key=gx+','+gy;
        if(!grid.has(key))grid.set(key,[]); grid.get(key).push(n);
      }
      for (const n of nodes) {
        const p=state.positions.get(n.id); if(!p)continue;
        const gx=Math.floor(p.x/cellSize), gy=Math.floor(p.y/cellSize);
        for(let ix=-1;ix<=1;ix++)for(let iy=-1;iy<=1;iy++){
          const bucket=grid.get((gx+ix)+','+(gy+iy)); if(!bucket)continue;
          for(const m of bucket){ if(m.id<=n.id)continue; const q=state.positions.get(m.id); if(!q)continue;
            let dx=q.x-p.x, dy=q.y-p.y, d=Math.hypot(dx,dy)||.01;
            const min=(radius(n)+radius(m))*3.1 + (n.type!==m.type?8:4);
            if(d<min){const push=(min-d)*.5; dx/=d;dy/=d; p.x-=dx*push; p.y-=dy*push; q.x+=dx*push; q.y+=dy*push;}
          }
        }
      }
    }
  }
  function averageMovieYear(node) {
    const mids = node.type === 'movie' ? [node.id] : (actorMovies.get(node.id) || []);
    const years = mids.map(id => byId.get(id)?.year).filter(Boolean);
    return years.length ? years.reduce((a,b)=>a+b,0) / years.length : 1990;
  }
  function layoutSolar(hubPos) {
    for (const h of state.hubs) state.positions.set(h, {...(hubPos.get(h) || {x:0,y:0})});
    const hubIds = [...state.hubs];
    const movieBuckets = new Map(), actorBuckets = new Map();
    for (const m of movies) {
      const c = state.cluster.get(m.id) || 0;
      if (!movieBuckets.has(c)) movieBuckets.set(c, []);
      movieBuckets.get(c).push(m);
    }
    for (const a of actors) {
      if (state.hubs.has(a.id)) continue;
      const c = state.cluster.get(a.id) || 0;
      if (!actorBuckets.has(c)) actorBuckets.set(c, []);
      actorBuckets.get(c).push(a);
    }
    function center(c) { return state.positions.get(hubIds[c % Math.max(1, hubIds.length)]) || {x:0,y:0}; }
    for (const [c, rows] of movieBuckets) {
      rows.sort((a,b)=>(b.degree||0)-(a.degree||0));
      rows.forEach((m,i) => {
        const p = center(c), angle = i * 2.3999632297 + randUnit(m.id,31) * .35;
        const r = 62 + Math.sqrt(i + 1) * 22 + Math.log1p(m.degree || 1) * 7;
        state.positions.set(m.id, {x:p.x + Math.cos(angle) * r, y:p.y + Math.sin(angle) * r});
      });
    }
    for (const [c, rows] of actorBuckets) {
      rows.sort((a,b)=>(b.degree||0)-(a.degree||0));
      rows.forEach((a,i) => {
        const p = center(c), angle = i * 2.3999632297 + randUnit(a.id,32) * .4;
        const r = 170 + Math.sqrt(i + 1) * 28 + Math.log1p(a.degree || 1) * 9;
        state.positions.set(a.id, {x:p.x + Math.cos(angle) * r, y:p.y + Math.sin(angle) * r});
      });
    }
  }
  function layoutTimeline() {
    const years = movies.map(m => m.year).filter(Boolean);
    const minYear = Math.min(...years), maxYear = Math.max(...years);
    const span = Math.max(1, maxYear - minYear);
    const clusterCount = Math.max(1, state.hubs.size || Number(hubLimit.value));
    function xForYear(year) { return ((year || 1990) - minYear) / span * 5200 - 2600; }
    function yForCluster(c) { return (c - (clusterCount - 1) / 2) * 56; }
    for (const m of movies) {
      const c = state.cluster.get(m.id) || 0;
      state.positions.set(m.id, {x:xForYear(m.year), y:yForCluster(c) + randUnit(m.id,41) * 22});
    }
    for (const a of actors) {
      const c = state.cluster.get(a.id) || 0;
      const y = yForCluster(c) - 22 - Math.log1p(a.degree || 1) * 7;
      state.positions.set(a.id, {x:xForYear(averageMovieYear(a)) + randUnit(a.id,42) * 34, y:y + randUnit(a.id,43) * 18});
    }
  }
  function applyTypeSeparation(){
    if (layoutMode.value === 'bands') return;
    const dx = Number(actorOffsetX.value) || 0;
    const dy = Number(actorOffsetY.value) || 0;
    for (const n of graph.nodes) {
      const p = state.positions.get(n.id); if (!p) continue;
      if (n.type === 'actor') { p.x += dx; p.y += dy; }
    }
  }
  function syncActorOffset(axis, source){
    const slider = axis === 'x' ? actorOffsetX : actorOffsetY;
    const input = axis === 'x' ? actorOffsetXValue : actorOffsetYValue;
    const value = Math.max(Number(slider.min), Math.min(Number(slider.max), Number(source.value) || 0));
    slider.value = value;
    input.value = value;
    layout();
    applyFilters();
  }
  function layout(){
    state.positions.clear();
    const hubs = leadHubActors();
    const hubPos = buildHubLayout(hubs);
    assignClusters(hubs, hubPos);
    if (layoutMode.value === 'semantic') {
      layoutSemanticCareer();
      applyTypeSeparation();
      fitGraph();
      return;
    }
    if (layoutMode.value === 'force') {
      layoutForceDirected(hubPos);
      applyTypeSeparation();
      fitGraph();
      return;
    }
    if (layoutMode.value === 'bands') {
      layoutBands();
      fitGraph();
      return;
    }
    if (layoutMode.value === 'solar') {
      layoutSolar(hubPos);
      applyTypeSeparation();
      fitGraph();
      return;
    }
    if (layoutMode.value === 'timeline') {
      layoutTimeline();
      applyTypeSeparation();
      fitGraph();
      return;
    }
    for (const h of hubs) state.positions.set(h.id, {...hubPos.get(h.id)});
    const hubIds = [...state.hubs];
    function hubForCluster(c) {
      return hubIds[c % Math.max(1, hubIds.length)];
    }
    function centerForCluster(c) {
      return hubPos.get(hubForCluster(c)) || {x:0, y:0};
    }
    function clusterPoint(c, id, index, kind, degree=1) {
      const center = centerForCluster(c);
      const golden = 2.399963229728653;
      const angle = index * golden + randUnit(id, 11) * .48;
      const base = kind === 'movie' ? 48 : 86;
      const step = kind === 'movie' ? 15.5 : 18.5;
      const ring = base + Math.sqrt(index + 1) * step + Math.log1p(degree || 1) * (kind === 'movie' ? 7 : 12);
      const warp = 1 + randUnit(id, 12) * .18;
      return {x:center.x + Math.cos(angle) * ring * warp, y:center.y + Math.sin(angle) * ring / warp};
    }
    function bridgePoint(ids, fallbackCluster, id, index, degree=1) {
      const clusters = [...new Set(ids.map(aid => state.cluster.get(aid)).filter(c => c !== undefined))];
      if (clusters.length < 2) return clusterPoint(fallbackCluster, id, index, 'movie', degree);
      let x=0, y=0, w=0;
      for (const c of clusters) {
        const p = centerForCluster(c);
        const ww = c === fallbackCluster ? 1.8 : 1;
        x += p.x * ww; y += p.y * ww; w += ww;
      }
      const spread = 28 + Math.sqrt(index + 1) * 3 + Math.log1p(degree || 1) * 5;
      return {x:x/w + randUnit(id, 13) * spread, y:y/w + randUnit(id, 14) * spread};
    }
    const movieBuckets = new Map(), actorBuckets = new Map();
    for (const m of movies) {
      const c = state.cluster.get(m.id) || 0;
      if (!movieBuckets.has(c)) movieBuckets.set(c, []);
      movieBuckets.get(c).push(m);
    }
    for (const a of actors) {
      if (state.hubs.has(a.id)) continue;
      const c = state.cluster.get(a.id) || 0;
      if (!actorBuckets.has(c)) actorBuckets.set(c, []);
      actorBuckets.get(c).push(a);
    }
    for (const [c, rows] of movieBuckets) {
      rows.sort((a,b)=>(b.degree||0)-(a.degree||0));
      rows.forEach((m, i) => {
        const aids = movieActors.get(m.id) || [];
        state.positions.set(m.id, bridgePoint(aids, c, m.id, i, m.degree || 1));
      });
    }
    for (const [c, rows] of actorBuckets) {
      rows.sort((a,b)=>(b.degree||0)-(a.degree||0));
      rows.forEach((a, i) => state.positions.set(a.id, clusterPoint(c, a.id, i, 'actor', a.degree || 1)));
    }
    applyTypeSeparation();
    fitGraph();
  }
  function fitGraph(){
    const pts = state.visibleNodes.map(n => state.positions.get(n.id)).filter(Boolean);
    if(!pts.length) return;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const p of pts){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
    const mobileFit = window.matchMedia('(max-width: 900px)').matches;
    const pad=mobileFit ? 24 : 60;
    state.bounds = {minX, maxX, minY, maxY, pad};
    const rawFitScale = Math.min((state.width-pad*2)/Math.max(1,maxX-minX),(state.height-pad*2)/Math.max(1,maxY-minY));
    const fitScale = Math.max(mobileFit ? .012 : .08, rawFitScale);
    state.minScale = mobileFit ? Math.max(.012, fitScale * .55) : Math.min(1.1, fitScale);
    state.scale=Math.min(1.1, fitScale);
    state.panX=(state.width-(minX+maxX)*state.scale)/2;
    state.panY=(state.height-(minY+maxY)*state.scale)/2;
    clampPan();
    draw();
  }
  function clampPan(){
    const b = state.bounds;
    if(!b) return;
    const pad = b.pad || 60;
    const contentW = (b.maxX - b.minX) * state.scale;
    const contentH = (b.maxY - b.minY) * state.scale;
    if(contentW <= Math.max(1, state.width - pad * 2)) {
      state.panX = (state.width - (b.minX + b.maxX) * state.scale) / 2;
    } else {
      const minPan = state.width - pad - b.maxX * state.scale;
      const maxPan = pad - b.minX * state.scale;
      state.panX = Math.max(minPan, Math.min(maxPan, state.panX));
    }
    if(contentH <= Math.max(1, state.height - pad * 2)) {
      state.panY = (state.height - (b.minY + b.maxY) * state.scale) / 2;
    } else {
      const minPan = state.height - pad - b.maxY * state.scale;
      const maxPan = pad - b.minY * state.scale;
      state.panY = Math.max(minPan, Math.min(maxPan, state.panY));
    }
  }
  function resize(){const r=window.devicePixelRatio||1; state.width=canvas.clientWidth; state.height=canvas.clientHeight; canvas.width=Math.floor(state.width*r); canvas.height=Math.floor(state.height*r); ctx.setTransform(r,0,0,r,0,0); fitGraph();}
  function nodeSortValue(n, mode){
    if(n.type === 'actor') {
      const votes = actorVoteTotals.get(n.id) || {votes:0, avgRating:0, first:0, last:0};
      const lead = leadCounts.get(n.id) || 0;
      if(mode === 'lead') return lead;
      if(mode === 'leadShare') return lead / Math.max(1, n.degree || 0);
      if(mode === 'votes') return votes.votes;
      if(mode === 'rating') return votes.avgRating;
      if(mode === 'newest') return votes.last;
      if(mode === 'oldest') return -votes.first;
      return n.degree || 0;
    }
    if(mode === 'lead') return movieLead.has(n.id) ? 1 : 0;
    if(mode === 'leadShare') return movieLead.has(n.id) ? 1 / Math.max(1, n.degree || 0) : 0;
    if(mode === 'votes') return Number(n.vote_count || 0);
    if(mode === 'rating') return Number(n.rating || 0);
    if(mode === 'newest') return Number(n.year || 0);
    if(mode === 'oldest') return -Number(n.year || 0);
    return n.degree || 0;
  }
  function sortNodes(rows, mode){
    if(mode === 'title') return rows.sort((a,b)=>String(a.label).localeCompare(String(b.label)));
    return rows.sort((a,b)=>nodeSortValue(b, mode)-nodeSortValue(a, mode)||String(a.label).localeCompare(String(b.label)));
  }
  function renderResults(){
    const q=search.value.trim().toLowerCase();
    let rows=graph.nodes;
    resultSortWrap.style.display = q ? 'none' : '';
    if(q) {
      rows=rows
        .filter(n => `${n.label||''} ${n.year||''}`.toLowerCase().includes(q))
        .sort((a,b)=>{
          const al=String(a.label||'').toLowerCase(), bl=String(b.label||'').toLowerCase();
          const ar=al===q ? 0 : al.startsWith(q) ? 1 : al.includes(q) ? 2 : 3;
          const br=bl===q ? 0 : bl.startsWith(q) ? 1 : bl.includes(q) ? 2 : 3;
          return ar-br || String(a.label).localeCompare(String(b.label));
        });
    } else {
      rows=sortNodes([...rows], resultSort.value);
    }
    rows=rows.slice(0,44);
    results.innerHTML=rows.map(n=>`<button class="result ${n.id===state.selectedId?'active':''}" data-id="${esc(n.id)}" title="${esc(n.label)}"><span class="title">${esc(shortText(n.label, 48))}</span><span class="sub">${esc(shortText(resultMeta(n), 64))}</span></button>`).join('');
    for(const b of results.querySelectorAll('.result')) b.addEventListener('click',()=>selectNode(b.dataset.id));
  }
  function selectNode(id){state.selectedId=id; renderResults(); renderDetail(id ? byId.get(id) : null); draw();}
  function detailSortOptions(n){
    return `<option value="votes" selected>Most votes</option><option value="rating">Highest rating</option><option value="newest">Newest</option><option value="oldest">Oldest</option>`;
  }
  function selectedNeighbors(n, mode){
    if(n.type === 'movie') {
      let rows = (movieToEdges.get(n.id) || [])
        .map(e => ({node:byId.get(e.source), edge:e}))
        .filter(row => row.node);
      if(mode === 'castOrder') rows.sort((a,b)=>a.edge.order-b.edge.order||String(a.node.label).localeCompare(String(b.node.label)));
      else rows.sort((a,b)=>nodeSortValue(b.node, mode)-nodeSortValue(a.node, mode)||String(a.node.label).localeCompare(String(b.node.label)));
      return rows.map(row => row.node);
    }
    let rows = (actorToEdges.get(n.id) || [])
      .map(e => ({node:byId.get(e.target), edge:e}))
      .filter(row => row.node);
    if(mode === 'mainLead') rows = rows.filter(row => row.edge.isMain);
    if(mode === 'title') rows.sort((a,b)=>String(a.node.label).localeCompare(String(b.node.label)));
    else rows.sort((a,b)=>nodeSortValue(b.node, mode)-nodeSortValue(a.node, mode)||String(a.node.label).localeCompare(String(b.node.label)));
    return rows.map(row => row.node);
  }
  function renderDetail(n){
	    if(!n){
	      const actorLegend = actorColorLegend();
	      const movieLegend = movieColorLegend();
	      detail.innerHTML = `<h2>Map Guide</h2><div class="axis-note"><div><strong>X:</strong> movies are positioned by release year.</div><div><strong>Y:</strong> collaboration groups place people and films near the actors they most often share credits with.</div><div><strong>Actors:</strong> actor positions use their collaboration group and are offset down-left from the movie layer for clearer separation.</div></div><div><label>${esc(actorLegend.label)}</label><div class="cluster-key">${actorLegend.rows}</div><div class="hint">${esc(actorLegend.hint)}</div></div><div><label>${esc(movieLegend.label)}</label><div class="cluster-key">${movieLegend.rows}</div><div class="hint">${esc(movieLegend.hint)}</div></div>`;
	      return;
	    }
    const img=imageFor(n);
    const sortId = `detailSort-${n.id.replace(/[^a-zA-Z0-9_-]/g,'_')}`;
    const currentSort = n.type === 'movie' ? 'castOrder' : 'votes';
    const ids=selectedNeighbors(n, currentSort).slice(0,90);
    const leadTag = n.type==='actor' && isMainLeadActor(n.id) ? `<button type="button" class="pill pill-action" id="mainLeadMovies">${(leadCounts.get(n.id)||0).toLocaleString()} main-lead movies</button>` : '';
    const sortControl = n.type === 'actor' ? `<div><label for="${esc(sortId)}">Sort Movies</label><select id="${esc(sortId)}" class="detail-sort">${detailSortOptions(n)}</select></div>` : '';
    const itemMeta = x => x.type === 'movie' ? movieBrief(x) : actorBrief(x, resultSort.value === 'lead');
    detail.innerHTML=`<div class="identity">${img?`<img class="poster" src="${esc(img)}" alt="">`:''}<div><h2 title="${esc(n.label)}">${esc(shortText(n.label, 70))}</h2><div class="hint">${esc(shortText(selectedMeta(n), 90))}</div></div></div><div class="pill-row">${leadTag}${genres(n).map(g=>`<span class="pill">${esc(g)}</span>`).join('')}</div>${sortControl}<div><label>${n.type==='movie'?'Actors In This Film':'Movies With This Actor'}</label><div class="neighbor-list">${ids.map(x=>`<button class="neighbor" data-id="${esc(x.id)}" title="${esc(x.label)}"><span class="title">${esc(shortText(x.label, 48))}</span><span class="sub">${esc(shortText(itemMeta(x), 64))}</span></button>`).join('') || '<div class="hint">No connected nodes.</div>'}</div></div>`;
    const renderNeighborRows = rows => {
      const list = detail.querySelector('.neighbor-list');
      list.innerHTML = rows.map(x=>`<button class="neighbor" data-id="${esc(x.id)}" title="${esc(x.label)}"><span class="title">${esc(shortText(x.label, 48))}</span><span class="sub">${esc(shortText(itemMeta(x), 64))}</span></button>`).join('') || '<div class="hint">No connected nodes.</div>';
      for(const b of list.querySelectorAll('.neighbor')) b.addEventListener('click',()=>selectNode(b.dataset.id));
    };
    const detailSort = detail.querySelector('.detail-sort');
    if(detailSort) detailSort.addEventListener('change',()=>{
      const rows = selectedNeighbors(n, detailSort.value).slice(0,90);
      renderNeighborRows(rows);
    });
    const leadButton = detail.querySelector('#mainLeadMovies');
    if(leadButton) leadButton.addEventListener('click',()=>renderNeighborRows(selectedNeighbors(n, 'mainLead').slice(0,90)));
    for(const b of detail.querySelectorAll('.neighbor')) b.addEventListener('click',()=>selectNode(b.dataset.id));
  }
	  function drawSemanticAxes(){
	    if(layoutMode.value !== 'semantic') return;
	    const axis = semanticYInfo();
	    const pts = state.visibleNodes.map(n => state.positions.get(n.id)).filter(Boolean);
	    if(!pts.length) return;
	    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
	    for(const p of pts){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
	    const years = movies.map(m=>m.year).filter(Boolean);
	    const minYear = Math.min(...years), maxYear = Math.max(...years);
	    const yWorld = maxY + Math.max(80, (maxY-minY)*.05);
	    const left = worldToScreen({x:minX,y:yWorld}), right = worldToScreen({x:maxX,y:yWorld});
	    ctx.save();
	    ctx.globalAlpha=.78;
	    ctx.strokeStyle='rgba(190,213,232,.38)';
	    ctx.lineWidth=1;
	    ctx.beginPath(); ctx.moveTo(left.x,left.y); ctx.lineTo(right.x,right.y); ctx.stroke();
	    ctx.fillStyle='rgba(219,238,250,.9)';
	    ctx.font='600 11px system-ui';
	    ctx.textAlign='center';
	    if(semanticYMode.value === 'starPower') {
	      for(const tick of [0, .25, .5, .75, 1]){
	        const xWorld = minX + tick * (maxX-minX);
	        const p = worldToScreen({x:xWorld,y:yWorld});
	        ctx.strokeStyle='rgba(190,213,232,.28)';
	        ctx.beginPath(); ctx.moveTo(p.x,p.y-4); ctx.lineTo(p.x,p.y+4); ctx.stroke();
	        ctx.fillText(tick === 0 ? 'low' : tick === 1 ? 'high' : `${Math.round(tick*100)}%`,p.x,p.y+17);
	      }
	      const xWorld = minX - Math.max(80, (maxX-minX)*.025);
	      const top = worldToScreen({x:xWorld,y:minY}), bottom = worldToScreen({x:xWorld,y:maxY});
	      ctx.strokeStyle='rgba(190,213,232,.38)';
	      ctx.beginPath(); ctx.moveTo(top.x,top.y); ctx.lineTo(bottom.x,bottom.y); ctx.stroke();
	      const yearTicks = [minYear, 1960, 1980, 2000, 2020, maxYear].filter((v,i,a)=>v>=minYear&&v<=maxYear&&a.indexOf(v)===i);
	      ctx.textAlign='right';
	      for(const year of yearTicks){
	        const yTick = minY + ((year-minYear)/Math.max(1,maxYear-minYear))*(maxY-minY);
	        const p = worldToScreen({x:xWorld,y:yTick});
	        ctx.strokeStyle='rgba(190,213,232,.28)';
	        ctx.beginPath(); ctx.moveTo(p.x-4,p.y); ctx.lineTo(p.x+4,p.y); ctx.stroke();
	        ctx.fillText(String(year),p.x-8,p.y+4);
	      }
	    } else {
	      const ticks = [minYear, 1960, 1980, 2000, 2020, maxYear].filter((v,i,a)=>v>=minYear&&v<=maxYear&&a.indexOf(v)===i);
	      for(const year of ticks){
	        const xWorld = minX + ((year-minYear)/Math.max(1,maxYear-minYear))*(maxX-minX);
	        const p = worldToScreen({x:xWorld,y:yWorld});
	        ctx.strokeStyle='rgba(190,213,232,.28)';
	        ctx.beginPath(); ctx.moveTo(p.x,p.y-4); ctx.lineTo(p.x,p.y+4); ctx.stroke();
	        ctx.fillText(String(year),p.x,p.y+17);
	      }
	    }
	    ctx.textAlign='left';
	    ctx.fillStyle='rgba(219,238,250,.95)';
	    ctx.fillText('X: movie release year', Math.max(18,left.x), left.y+36);
	    ctx.translate(Math.max(18,left.x), Math.max(118,left.y-140));
	    ctx.rotate(-Math.PI/2);
	    ctx.textAlign='center';
	    ctx.fillText('Y: collaboration group', 0, 0);
	    ctx.restore();
	  }
  function draw(){
    ctx.clearRect(0,0,state.width,state.height);
    const bg=ctx.createRadialGradient(state.width*.47,state.height*.46,0,state.width*.5,state.height*.5,Math.max(state.width,state.height)*.72);
    bg.addColorStop(0,'#09111f'); bg.addColorStop(.62,'#040812'); bg.addColorStop(1,'#02040a');
    ctx.fillStyle=bg; ctx.fillRect(0,0,state.width,state.height);
    drawSemanticAxes();
    const visibleIds = new Set(state.visibleNodes.map(n=>n.id));
    const focusId = state.hoverId || state.selectedId;
    const focus=related(focusId), hasFocus=focus.size>0;
    for(const e of state.visibleEdges){
      if(!visibleIds.has(e.source)||!visibleIds.has(e.target))continue;
      if(!hasFocus && nodeMode.value==='all' && !e.isMain) {
        if (layoutMode.value === 'force' && state.scale < .22 && e.index % 4) continue;
        if (layoutMode.value !== 'force' && state.scale < .13 && e.index % 3) continue;
      }
      const a=state.positions.get(e.source), b=state.positions.get(e.target); if(!a||!b)continue;
      const sa=worldToScreen(a), sb=worldToScreen(b);
      const active=!hasFocus || (focus.has(e.source)&&focus.has(e.target));
      const direct=hasFocus && (e.source===focusId || e.target===focusId);
      if(hasFocus && !active && layoutMode.value === 'force' && e.index % 3) continue;
      const c=hasFocus && active ? (e.isMain ? '#2399aa' : '#58d5e8') : (e.isMain?'#58d5e8':'#778395');
      const lowActorEdge = isLowFilmActor(byId.get(e.source)) || isLowFilmActor(byId.get(e.target));
      const focusNode = byId.get(focusId);
      const lowActorFocused = direct && isLowFilmActor(focusNode);
      const full = nodeMode.value === 'all';
      const bands = layoutMode.value === 'bands';
      const force = layoutMode.value === 'force';
      const semantic = layoutMode.value === 'semantic';
      let alpha = hasFocus
        ? (direct ? (e.isMain ? .56 : .36) : active ? (e.isMain ? .24 : .13) : .026)
        : (semantic ? (e.isMain?.12:.028) : force ? (e.isMain?.12:.032) : bands ? (e.isMain?.2:.085) : full ? (e.isMain?.09:.035) : (e.isMain?.22:.105));
      if(lowActorEdge && !lowActorFocused) alpha *= hasFocus && active ? .48 : .34;
      ctx.strokeStyle=rgba(c, alpha);
      let lineWidth=hasFocus
        ? (direct ? (e.isMain ? 1.35 : .9) : active ? (e.isMain ? .72 : .44) : .2)
        : (semantic ? (e.isMain?.38:.16) : force ? (e.isMain?.42:.18) : bands ? (e.isMain?.62:.34) : full ? (e.isMain?.42:.22) : (e.isMain?.7:.44));
      if(lowActorEdge && !lowActorFocused) lineWidth *= hasFocus && active ? .74 : .68;
      ctx.lineWidth=lineWidth;
      ctx.beginPath();
      if (layoutMode.value === 'constellation' || layoutMode.value === 'solar') {
        const source = byId.get(e.source), target = byId.get(e.target);
        const c = state.cluster.get(source?.id) ?? state.cluster.get(target?.id) ?? 0;
        const h = [...state.hubs][c % Math.max(1, state.hubs.size)];
        const hp = h ? state.positions.get(h) : null;
        if (hp) {
          const sp = worldToScreen(hp);
          ctx.moveTo(sa.x, sa.y); ctx.quadraticCurveTo(sp.x, sp.y, sb.x, sb.y);
        } else {
          ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y);
        }
      } else {
        ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y);
      }
      ctx.stroke();
    }
    const ordered=[...state.visibleNodes].sort((a,b)=>(a.type==='actor'?1:0)-(b.type==='actor'?1:0) || (a.degree||0)-(b.degree||0));
    const labels = [];
    for(const n of ordered){
      const p0=state.positions.get(n.id); if(!p0)continue;
      if(!hasFocus && nodeMode.value==='all' && state.scale < .1 && n.type==='movie' && (n.degree||0) < 2) continue;
      const p=worldToScreen(p0), active=!hasFocus || focus.has(n.id), r=displayRadius(n);
      const full = nodeMode.value === 'all';
      const bands = layoutMode.value === 'bands';
      const force = layoutMode.value === 'force';
      const semantic = layoutMode.value === 'semantic';
      const lowActor = isLowFilmActor(n);
      const normalAlpha = lowActor ? ((force || semantic) ? .18 : .24) : ((force || semantic) && full ? (n.type==='movie' ? .54 : (state.hubs.has(n.id) ? .86 : .74)) : (full && n.type==='movie' ? (bands ? .9 : .8) : .94));
      const focusAlpha = lowActor ? .26 : (full ? .16 : .22);
      const idleAlpha = lowActor ? .14 : (full ? .2 : .38);
      const emphasized = n.id === focusId;
      ctx.globalAlpha=active ? (emphasized ? .92 : hasFocus && lowActor ? .28 : normalAlpha) : (hasFocus ? focusAlpha : idleAlpha);
      if(n.type==='actor' && n.degree>=120){
        const ringColor = n.degree>=150 ? '#e65d4f' : '#d7b45f';
        const halo = n.degree>=150 ? 4.5 : 3;
        ctx.save();
        ctx.globalAlpha=active ? (full ? ((force || semantic) ? .055 : bands ? .1 : .075) : (n.degree>=150 ? .14 : .1)) : (hasFocus ? .035 : .04);
        ctx.strokeStyle=ringColor;
        ctx.lineWidth=n.degree>=150 ? 1.4 : .9;
        ctx.shadowBlur=halo;
        ctx.shadowColor=ringColor;
        ctx.beginPath(); ctx.arc(p.x,p.y,r+halo*.9,0,Math.PI*2); ctx.stroke();
        ctx.restore();
        ctx.globalAlpha=active ? (emphasized ? .92 : hasFocus && lowActor ? .28 : normalAlpha) : (hasFocus ? focusAlpha : idleAlpha);
      }
      ctx.fillStyle=color(n);
      ctx.shadowBlur=lowActor ? 0 : (n.type === 'movie' ? 0 : ((state.hubs.has(n.id)||n.id===state.selectedId||n.id===state.hoverId)?((force || semantic)?(hasFocus?2:3):(hasFocus?(full?2:5):(full?5:10))):(n.type==='actor'&&n.degree>=150?((force || semantic)?1.2:(full?2:4)):0)));
	      ctx.shadowColor=color(n);
	      if(n.type==='movie'){ctx.fillRect(p.x-r*.9,p.y-r*.9,r*1.8,r*1.8);} else {ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();}
	      ctx.shadowBlur=0;
		      if(hasFocus && active){ctx.globalAlpha=n.id===focusId ? .85 : .42;ctx.strokeStyle=n.id===focusId?'#f1ffd6':'#cfe9ff';ctx.lineWidth=n.id===focusId?1.35:.55;ctx.beginPath();ctx.arc(p.x,p.y,r+(n.id===focusId?2.8:1.6),0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;}
	      const label=shouldLabel(n, active, hasFocus);
      if(label) labels.push({n, x:p.x, y:p.y + r + 12});
      ctx.globalAlpha=1;
    }
    ctx.shadowBlur=0;
    ctx.textAlign='center';
    ctx.textBaseline='alphabetic';
    labels.sort((a,b)=>(a.n.id===state.selectedId?1:0)-(b.n.id===state.selectedId?1:0) || (a.n.id===state.hoverId?1:0)-(b.n.id===state.hoverId?1:0));
    for(const item of labels){
      const n = item.n;
      const text = n.label.length>26 ? n.label.slice(0,25)+'...' : n.label;
      ctx.globalAlpha=.72;
      ctx.font=labelFont(n);
      const w = ctx.measureText(text).width;
      ctx.fillStyle='rgba(2,4,10,.68)';
      ctx.fillRect(item.x - w/2 - 4, item.y - 11, w + 8, 15);
      ctx.globalAlpha=1;
      ctx.fillStyle=n.type==='movie'?'#eef3fb':'#d9f7ff';
      ctx.fillText(text,item.x,item.y);
    }
    ctx.globalAlpha=1;
  }
  function nearest(x,y){
    const p=screenToWorld(x,y); let best=null,d0=Infinity;
    for(const n of state.visibleNodes){const q=state.positions.get(n.id); if(!q)continue; const d=Math.hypot(q.x-p.x,q.y-p.y), hit=Math.max(8,displayRadius(n)/Math.max(.12,state.scale)+4); if(d<hit&&d<d0){best=n;d0=d;}}
    return best;
  }
  const activePointers = new Map();
  let pendingDraw = 0, settleTimer = 0, lastLiveDraw = 0;
  function mobileCanvas(){return window.matchMedia('(max-width: 900px)').matches;}
  function clearInteractionFrame(){state.interactionFrame=null;}
  function captureInteractionFrame(force=false){
    if(!mobileCanvas() || (!force && state.interactionFrame) || state.width<=0 || state.height<=0) return;
    const snapshot=document.createElement('canvas');
    snapshot.width=canvas.width;
    snapshot.height=canvas.height;
    const snapshotCtx=snapshot.getContext('2d');
    if(!snapshotCtx) return;
    snapshotCtx.drawImage(canvas,0,0);
    state.interactionFrame={canvas:snapshot,width:state.width,height:state.height,scale:state.scale,panX:state.panX,panY:state.panY};
  }
  function needsLiveInteractionDraw(){
    const frame=state.interactionFrame;
    if(!frame || !frame.scale) return true;
    const now=performance.now();
    const scaleRatio=state.scale/frame.scale;
    const panDelta=Math.hypot(state.panX-frame.panX,state.panY-frame.panY);
    if(scaleRatio > 1.18 || scaleRatio < .85) return true;
    if(panDelta > Math.max(120, state.width * .35)) return true;
    return now - lastLiveDraw > 160;
  }
  function liveInteractionDraw(){
    clearInteractionFrame();
    draw();
    lastLiveDraw=performance.now();
    captureInteractionFrame(true);
  }
  function drawInteractionPreview(){
    const frame=state.interactionFrame;
    if(!mobileCanvas() || !frame || !frame.scale){draw();return;}
    const dpr=window.devicePixelRatio||1;
    const ratio=state.scale/frame.scale;
    const dx=state.panX-frame.panX*ratio;
    const dy=state.panY-frame.panY*ratio;
    ctx.save();
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,state.width,state.height);
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(frame.canvas,dx,dy,frame.width*ratio,frame.height*ratio);
    ctx.restore();
  }
  function requestGraphDraw(final=false){
    if(final){
      if(pendingDraw){cancelAnimationFrame(pendingDraw);pendingDraw=0;}
      clearInteractionFrame();
      draw(); return;
    }
    if(!mobileCanvas()){draw(); return;}
    if(pendingDraw) return;
    pendingDraw=requestAnimationFrame(()=>{
      pendingDraw=0;
      if(!state.interacting){draw();return;}
      if(needsLiveInteractionDraw()) liveInteractionDraw();
      else drawInteractionPreview();
    });
  }
  function beginInteraction(){
    if(settleTimer){clearTimeout(settleTimer);settleTimer=0;}
    if(mobileCanvas()){
      captureInteractionFrame();
      lastLiveDraw=performance.now();
      state.interacting=true;
    } else {
      state.interacting=false;
    }
  }
  function endInteraction(){
    if(!state.interacting) return;
    if(settleTimer) clearTimeout(settleTimer);
    settleTimer=setTimeout(()=>{state.interacting=false;requestGraphDraw(true);},90);
  }
  function finishTapSelection(node){
    if(settleTimer){clearTimeout(settleTimer);settleTimer=0;}
    state.interacting=false;
    clearInteractionFrame();
    selectNode(node ? node.id : '');
    openMobileDetail(node);
  }
  function canvasPoint(e){const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top,clientX:e.clientX,clientY:e.clientY};}
  function activePoints(){return Array.from(activePointers.values());}
  function midpoint(points){return {x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2};}
  function pointDistance(points){return Math.max(1,Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y));}
  function startPinch(){
    const points=activePoints();
    if(points.length<2)return;
    const center=midpoint(points);
    state.pinch={dist:pointDistance(points),scale:state.scale,world:screenToWorld(center.x,center.y)};
    state.pinching=true;
    state.drag=null;
  }
  function hoverAt(x,y){
    const h=nearest(x,y),next=h?h.id:'';
    if(next!==state.hoverId){state.hoverId=next;canvas.style.cursor=h?'pointer':'grab';requestGraphDraw();}
  }
  function nearestTouch(x,y){
    if(!mobileCanvas()) return nearest(x,y);
    let best=null,d0=Infinity;
    for(const n of state.visibleNodes){
      const q=state.positions.get(n.id); if(!q)continue;
      const p=worldToScreen(q), d=Math.hypot(p.x-x,p.y-y);
      const hit=Math.max(n.type==='actor'?22:18,displayRadius(n)+12);
      if(d<hit&&d<d0){best=n;d0=d;}
    }
    return best;
  }
  function openMobileDetail(node){
    if(node && mobileCanvas() && window.networkSetPanel) window.networkSetPanel('detail');
  }
  canvas.addEventListener('pointerdown',e=>{
    e.preventDefault();
    beginInteraction();
    const p=canvasPoint(e);
    activePointers.set(e.pointerId,p);
    if(canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
    state.pointer={x:p.x,y:p.y};
    state.drag={x:e.clientX,y:e.clientY,panX:state.panX,panY:state.panY};
    if(activePointers.size>=2) startPinch();
  });
  canvas.addEventListener('pointermove',e=>{
    if(!activePointers.has(e.pointerId)){const p=canvasPoint(e);hoverAt(p.x,p.y);return;}
    e.preventDefault();
    const p=canvasPoint(e);
    activePointers.set(e.pointerId,p);
    if(activePointers.size>=2){
      if(!state.pinch) startPinch();
      const points=activePoints(),center=midpoint(points),dist=pointDistance(points);
      state.scale=Math.max(state.minScale||.06,Math.min(4,state.pinch.scale*(dist/state.pinch.dist)));
      state.panX=center.x-state.pinch.world.x*state.scale;
      state.panY=center.y-state.pinch.world.y*state.scale;
      clampPan(); requestGraphDraw(); return;
    }
    if(state.drag){
      state.panX=state.drag.panX+e.clientX-state.drag.x;
      state.panY=state.drag.panY+e.clientY-state.drag.y;
      clampPan(); requestGraphDraw(); return;
    }
    hoverAt(p.x,p.y);
  });
  canvas.addEventListener('pointerup',e=>{
    const p=canvasPoint(e),wasPinch=!!state.pinching;
    activePointers.delete(e.pointerId);
    if(canvas.releasePointerCapture) { try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} }
    const tapLimit=e.pointerType==='touch' ? 22 : 8;
    const wasClick=!wasPinch && Math.hypot(p.x-state.pointer.x,p.y-state.pointer.y)<tapLimit;
    const clicked=wasClick?nearestTouch(p.x,p.y):null;
    if(activePointers.size>=2){startPinch();}
    else if(activePointers.size===1){
      const remaining=activePoints()[0];
      state.pinch=null;
      state.drag={x:remaining.clientX,y:remaining.clientY,panX:state.panX,panY:state.panY};
      state.pointer={x:remaining.x,y:remaining.y};
    } else {
      state.drag=null; state.pinch=null; state.pinching=false;
      endInteraction();
    }
    if(wasClick){
      finishTapSelection(clicked);
    }
  });
  canvas.addEventListener('pointercancel',e=>{activePointers.delete(e.pointerId);state.drag=null;state.pinch=null;state.pinching=false;if(!activePointers.size)endInteraction();});
  canvas.addEventListener('pointerleave',()=>{if(!activePointers.size){state.hoverId='';state.drag=null;requestGraphDraw(true);}});
  canvas.addEventListener('gesturestart',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{e.preventDefault();beginInteraction();const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,b=screenToWorld(x,y);state.scale=Math.max(state.minScale||.06,Math.min(4,state.scale*(e.deltaY<0?1.12:.89)));state.panX=x-b.x*state.scale;state.panY=y-b.y*state.scale;clampPan();requestGraphDraw();endInteraction();},{passive:false});
  let touchStart=null, touchWasPinch=false;
  function touchPoint(t){const r=canvas.getBoundingClientRect();return {x:t.clientX-r.left,y:t.clientY-r.top,clientX:t.clientX,clientY:t.clientY};}
  function touchList(e){return Array.from(e.touches).map(touchPoint);}
  canvas.addEventListener('touchstart',e=>{
    if(window.PointerEvent) return;
    e.preventDefault(); beginInteraction();
    const points=touchList(e); if(!points.length)return;
    touchStart={x:points[0].x,y:points[0].y};
    touchWasPinch=points.length>=2;
    if(points.length>=2){
      const center=midpoint(points);
      state.pinch={dist:pointDistance(points),scale:state.scale,world:screenToWorld(center.x,center.y)};
      state.pinching=true; state.drag=null;
    } else {
      state.pinching=false; state.pinch=null;
      state.pointer={x:points[0].x,y:points[0].y};
      state.drag={x:points[0].clientX,y:points[0].clientY,panX:state.panX,panY:state.panY};
    }
  },{passive:false});
  canvas.addEventListener('touchmove',e=>{
    if(window.PointerEvent) return;
    e.preventDefault();
    const points=touchList(e); if(!points.length)return;
    if(points.length>=2){
      touchWasPinch=true;
      if(!state.pinch){
        const center=midpoint(points);
        state.pinch={dist:pointDistance(points),scale:state.scale,world:screenToWorld(center.x,center.y)};
      }
      const center=midpoint(points), dist=pointDistance(points);
      state.scale=Math.max(state.minScale||.06,Math.min(4,state.pinch.scale*(dist/state.pinch.dist)));
      state.panX=center.x-state.pinch.world.x*state.scale;
      state.panY=center.y-state.pinch.world.y*state.scale;
      clampPan(); requestGraphDraw(); return;
    }
    if(state.drag){
      state.panX=state.drag.panX+points[0].clientX-state.drag.x;
      state.panY=state.drag.panY+points[0].clientY-state.drag.y;
      clampPan(); requestGraphDraw();
    }
  },{passive:false});
  canvas.addEventListener('touchend',e=>{
    if(window.PointerEvent) return;
    e.preventDefault();
    if(e.touches.length){
      const points=touchList(e);
      if(points.length===1){
        state.pinch=null; state.pinching=false;
        state.pointer={x:points[0].x,y:points[0].y};
        state.drag={x:points[0].clientX,y:points[0].clientY,panX:state.panX,panY:state.panY};
      }
      return;
    }
    const changed=Array.from(e.changedTouches).map(touchPoint)[0];
    const wasClick=changed && !touchWasPinch && touchStart && Math.hypot(changed.x-touchStart.x,changed.y-touchStart.y)<22;
    const clicked=wasClick?nearestTouch(changed.x,changed.y):null;
    state.drag=null; state.pinch=null; state.pinching=false;
    if(wasClick){finishTapSelection(clicked);}
    else endInteraction();
    touchStart=null; touchWasPinch=false;
  },{passive:false});
  canvas.addEventListener('touchcancel',()=>{if(window.PointerEvent)return;state.drag=null;state.pinch=null;state.pinching=false;touchStart=null;touchWasPinch=false;endInteraction();},{passive:false});
  window.addEventListener('resize',resize);
  search.addEventListener('input',renderResults);
  resultSort.addEventListener('change',renderResults);
  movieColorMode.addEventListener('change',()=>{renderDetail(state.selectedId ? byId.get(state.selectedId) : null);draw();});
  actorColorMode.addEventListener('change',()=>{renderDetail(state.selectedId ? byId.get(state.selectedId) : null);draw();});
  edgeMode.addEventListener('change',applyFilters);
  actorOffsetX.addEventListener('input',()=>syncActorOffset('x',actorOffsetX));
  actorOffsetXValue.addEventListener('change',()=>syncActorOffset('x',actorOffsetXValue));
  actorOffsetY.addEventListener('input',()=>syncActorOffset('y',actorOffsetY));
  actorOffsetYValue.addEventListener('change',()=>syncActorOffset('y',actorOffsetYValue));
  nodeMode.addEventListener('change',applyFilters);
  nodeTypeMode.addEventListener('change',applyFilters);
  minActorFilms.addEventListener('input',applyFilters);
  minMovieVotes.addEventListener('input',applyFilters);
  minMovieRating.addEventListener('input',applyFilters);
  hubLimit.addEventListener('change',()=>{layout();applyFilters();});
  resize(); layout(); applyFilters();
  }
  bootNetworkApp().catch(error => {
    console.error(error);
    const detail = document.getElementById('detail');
    if (detail) detail.innerHTML = `<h2>Could not load network data</h2><div class="hint">Host this folder through a static web server so data/graph.json can be fetched.</div>`;
  });


(function setupResponsiveShell(){
  const controls = Array.from(document.querySelectorAll('.mobile-sheetbar [data-panel]'));
  if (!controls.length) return;
  const labelGraphButton = panel => {
    const button = document.querySelector('.mobile-sheetbar [data-panel="collapsed"]');
    if (button) button.textContent = panel === 'collapsed' ? 'Show Panel' : 'Expand Graph';
  };
  const setPanel = panel => {
    const previousPanel = document.body.dataset.panel;
    document.body.dataset.panel = panel;
    for (const control of controls) control.classList.toggle('active', control.dataset.panel === panel);
    labelGraphButton(panel);
    if (previousPanel === 'collapsed' || panel === 'collapsed') {
      setTimeout(() => window.dispatchEvent(new Event('resize')), 40);
    }
  };
  window.networkSetPanel = setPanel;
  for (const control of controls) control.addEventListener('click', () => setPanel(control.dataset.panel));
  document.getElementById('results')?.addEventListener('click', event => {
    if (event.target.closest('.result')) setTimeout(() => setPanel('detail'), 0);
  });
  document.getElementById('detail')?.addEventListener('click', event => {
    if (event.target.closest('.neighbor')) setTimeout(() => setPanel('detail'), 0);
  });
  document.getElementById('search')?.addEventListener('focus', () => {
    if (window.matchMedia('(max-width: 900px)').matches) setPanel('list');
  });
  setPanel('list');
})();
