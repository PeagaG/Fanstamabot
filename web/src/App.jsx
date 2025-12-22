import React, { useState, useEffect } from 'react';
import { Trash2, Plus, Power, PowerOff, Activity, Bot, RefreshCw, Layers, Send, ArrowRight, Settings } from 'lucide-react';
import io from 'socket.io-client';
import './App.css';

const API_URL = '/api';
const socket = io();

function App() {
  const [rules, setRules] = useState([]);
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);

  // Rule State
  const [newRule, setNewRule] = useState({
    source_chat_id: '',
    target_chat_id: '',
    title: '',
    target_thread_id: '',
    source_thread_id: ''
  });

  // Batch State
  const [batch, setBatch] = useState({
    source_chat_id: '',
    target_chat_id: '',
    limit: 50,
    onlyAlbums: false,
    source_topic_id: '',
    target_thread_id: '',
    allowRepeats: false
  });

  const [mediaCount, setMediaCount] = useState(null);
  const [progress, setProgress] = useState(null);

  // Topics State
  const [ruleTargetTopics, setRuleTargetTopics] = useState([]);
  const [ruleSourceTopics, setRuleSourceTopics] = useState([]);
  const [batchSourceTopics, setBatchSourceTopics] = useState([]);
  const [batchTargetTopics, setBatchTargetTopics] = useState([]);

  const [botInfo, setBotInfo] = useState(null);
  const [logs, setLogs] = useState([]);

  // --- Initial Data ---
  useEffect(() => {
    fetchData();
    fetchBotInfo();

    socket.on('connect', () => {
      addLog({ message: '🔌 Conectado ao servidor', type: 'system', time: new Date().toLocaleTimeString() });
    });
    socket.on('log', (log) => addLog(log));
    socket.on('progress', (data) => setProgress(data));

    return () => {
      socket.off('connect');
      socket.off('log');
      socket.off('progress');
    };
  }, []);

  const addLog = (log) => {
    setLogs((prev) => [log, ...prev].slice(0, 100));
  };

  const fetchBotInfo = async () => {
    try {
      const res = await fetch(`${API_URL}/bot-info`);
      setBotInfo(await res.json());
    } catch (e) { console.error(e); }
  };

  const fetchData = async () => {
    try {
      const [rulesRes, chatsRes] = await Promise.all([
        fetch(`${API_URL}/rules`),
        fetch(`${API_URL}/chats`)
      ]);
      setRules(await rulesRes.json());
      setChats(await chatsRes.json());
    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  const fetchMediaCount = async (chatId) => {
    if (!chatId || chatId === 'custom') return setMediaCount(null);
    try {
      const res = await fetch(`${API_URL}/media-count/${chatId}`);
      const data = await res.json();
      setMediaCount(data.count);
    } catch (e) { console.error(e); }
  };

  // --- Topics Fetching Logic ---
  const fetchTopics = async (chatId, type) => {
    // Reset state if invalid
    if (!chatId || chatId === 'custom') {
      const empty = [];
      if (type === 'ruleTarget') setRuleTargetTopics(empty);
      if (type === 'ruleSource') setRuleSourceTopics(empty);
      if (type === 'batchSource') setBatchSourceTopics(empty);
      if (type === 'batchTarget') setBatchTargetTopics(empty);
      return;
    }

    try {
      // Determine Endpoint
      // 'batchSource' is unique because we want TOPICS THAT HAVE MEDIA.
      // ... BUT, user might want to filter by "General" (null) too? YES.
      // The current API endpoint `media-topics` returns only topics found in media_log.

      let url = `${API_URL}/chats/${chatId}/topics`;
      if (type === 'batchSource') url = `${API_URL}/chats/${chatId}/media-topics`;

      const res = await fetch(url);
      const data = await res.json();

      if (type === 'ruleTarget') setRuleTargetTopics(data);
      if (type === 'ruleSource') setRuleSourceTopics(data);
      if (type === 'batchSource') setBatchSourceTopics(data);
      if (type === 'batchTarget') setBatchTargetTopics(data);
    } catch (e) { console.error(e); }
  };

  // Watchers for Topic Lookups
  useEffect(() => fetchTopics(newRule.target_chat_id, 'ruleTarget'), [newRule.target_chat_id]);
  useEffect(() => fetchTopics(newRule.source_chat_id, 'ruleSource'), [newRule.source_chat_id]);
  useEffect(() => fetchTopics(batch.source_chat_id, 'batchSource'), [batch.source_chat_id]);
  useEffect(() => fetchTopics(batch.target_chat_id, 'batchTarget'), [batch.target_chat_id]);


  // --- Actions ---
  const handleAddRule = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRule),
      });
      if (res.ok) {
        setNewRule({ source_chat_id: '', target_chat_id: '', title: '', target_thread_id: '', source_thread_id: '' });
        fetchData();
        addLog({ message: 'Regra adicionada com sucesso', type: 'success', time: new Date().toLocaleTimeString() });
      }
    } catch (error) { console.error(error); }
  };

  const handleBatchForward = async (e) => {
    e.preventDefault();
    if (!window.confirm(`Confirma o envio de ${batch.limit} mensagens?`)) return;

    try {
      const res = await fetch(`${API_URL}/batch-forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      const data = await res.json();
      if (res.ok) {
        addLog({ message: data.message, type: 'system', time: new Date().toLocaleTimeString() });
      }
    } catch (e) { console.error(e); }
  };

  const handleDeleteRule = async (id) => {
    if (!window.confirm('Excluir esta regra?')) return;
    try {
      await fetch(`${API_URL}/rules/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (error) { console.error(error); }
  };

  const handleToggle = async (id) => {
    try {
      await fetch(`${API_URL}/rules/${id}/toggle`, { method: 'PATCH' });
      fetchData();
    } catch (error) { console.error(error); }
  };

  // --- Render Helpers ---

  const renderChatSelect = (value, onChange, placeholder = "Selecione um grupo...", mode = "") => (
    <div className="input-group">
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (mode === 'source') fetchMediaCount(e.target.value);
        }}
      >
        <option value="">{placeholder}</option>
        {chats.map(c => (
          <option key={c.chat_id} value={c.chat_id}>
            {c.title} ({c.type})
          </option>
        ))}
        <option value="custom">✏️ Digitar ID Manualmente</option>
      </select>

      {/* Show manual input if 'custom' OR if the current value is not in the list (and not empty) */}
      {(value === 'custom' || (value && !chats.find(c => c.chat_id == value))) && (
        <input
          type="text"
          placeholder="-100..."
          value={value === 'custom' ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2"
        />
      )}
    </div>
  );

  const renderTopicSelect = (value, onChange, topics, defaultLabel, chatId, refreshType) => (
    <div className="input-with-refresh">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={!chatId || chatId === 'custom'}
      >
        <option value="">{defaultLabel}</option>
        {topics && topics.map(t => (
          <option key={t.topic_id} value={t.topic_id}>
            #{t.name || 'Sem nome'} ({t.topic_id})
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn icon-only secondary small"
        onClick={() => fetchTopics(chatId, refreshType)}
        disabled={!chatId || chatId === 'custom'}
        title="Recarregar Tópicos"
      >
        <RefreshCw size={14} />
      </button>

      {/* Fallback for manual topic ID (always available in case list is bugged) */}
      <input
        type="number"
        placeholder="ID"
        className="small-input"
        style={{ width: '80px' }}
        value={value}
        onChange={e => onChange(e.target.value)}
        title="ID do Tópico (Opcional)"
      />
    </div>
  );


  return (
    <div className="container">
      <header className="header">
        <h1><Activity className="icon" /> FanstamaBot <span className="badge">v3.0</span></h1>
        <div className="bot-status">
          {botInfo ? (
            <span className="online"><Bot size={16} /> @{botInfo.username}</span>
          ) : (
            <span className="offline"><PowerOff size={16} /> Offline</span>
          )}
        </div>
      </header>

      <div className="main-content">
        <div className="dashboard-grid">

          {/* LEFT COLUMN: Actions */}
          <div className="left-col">

            {/* NEW RULE CARD */}
            <section className="card">
              <h2><Plus size={20} /> Nova Regra de Encaminhamento</h2>
              <form onSubmit={handleAddRule}>
                <div className="form-group">
                  <label>Título da Regra</label>
                  <input
                    type="text"
                    placeholder="Ex: Canal VIP -> Backup"
                    value={newRule.title}
                    onChange={(e) => setNewRule({ ...newRule, title: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Origem (De onde vem)</label>
                  {renderChatSelect(newRule.source_chat_id, (v) => setNewRule({ ...newRule, source_chat_id: v }))}
                </div>

                <div className="form-group">
                  <label>Tópico de Origem</label>
                  {renderTopicSelect(
                    newRule.source_thread_id || '',
                    (v) => setNewRule({ ...newRule, source_thread_id: v }),
                    ruleSourceTopics,
                    "Todos os Tópicos (Geral)",
                    newRule.source_chat_id,
                    'ruleSource'
                  )}
                </div>

                <div className="form-group" style={{ textAlign: 'center', opacity: 0.5 }}>
                  <ArrowRight size={24} style={{ transform: 'rotate(90deg)' }} />
                </div>

                <div className="form-group">
                  <label>Destino (Para onde vai)</label>
                  {renderChatSelect(newRule.target_chat_id, (v) => setNewRule({ ...newRule, target_chat_id: v }))}
                </div>

                <div className="form-group">
                  <label>Tópico de Destino</label>
                  {renderTopicSelect(
                    newRule.target_thread_id || '',
                    (v) => setNewRule({ ...newRule, target_thread_id: v }),
                    ruleTargetTopics,
                    "Geral (Sem tópico)",
                    newRule.target_chat_id,
                    'ruleTarget'
                  )}
                </div>

                <button type="submit" className="btn primary full-width">Criar Regra</button>
              </form>
            </section>

            {/* BATCH SEND CARD */}
            <section className="card batch-card">
              <h2><Layers size={20} /> Envio em Lote (Clonagem)</h2>
              <form onSubmit={handleBatchForward}>

                <div className="form-group">
                  <label>Origem da Clonagem</label>
                  {renderChatSelect(batch.source_chat_id, (v) => setBatch({ ...batch, source_chat_id: v }), "Selecione a origem...", 'source')}
                  {mediaCount !== null && (
                    <div className="count-badge">📦 {mediaCount} mídias registradas</div>
                  )}
                </div>

                <div className="form-group">
                  <label>Filtrar por Tópico (Opcional)</label>
                  {renderTopicSelect(
                    batch.source_topic_id || '',
                    (v) => setBatch({ ...batch, source_topic_id: v }),
                    batchSourceTopics,
                    "Todos os Tópicos",
                    batch.source_chat_id,
                    'batchSource'
                  )}
                </div>

                <div className="form-group">
                  <label>Destino</label>
                  {renderChatSelect(batch.target_chat_id, (v) => setBatch({ ...batch, target_chat_id: v }))}
                </div>

                <div className="form-group">
                  <label>Enviar para Tópico (Opcional)</label>
                  {renderTopicSelect(
                    batch.target_thread_id || '',
                    (v) => setBatch({ ...batch, target_thread_id: v }),
                    batchTargetTopics,
                    "Geral (Sem tópico)",
                    batch.target_chat_id,
                    'batchTarget'
                  )}
                </div>

                <div className="form-group">
                  <label>Limite de Itens</label>
                  <input
                    type="number" min="1" max="2000"
                    value={batch.limit}
                    onChange={(e) => setBatch({ ...batch, limit: parseInt(e.target.value) })}
                  />
                </div>

                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={batch.onlyAlbums}
                      onChange={(e) => setBatch({ ...batch, onlyAlbums: e.target.checked })}
                    />
                    <span>Apenas Álbuns</span>
                  </label>

                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={batch.allowRepeats}
                      onClick={(e) => { if (!window.confirm("Cuidado: Isso pode duplicar mensagens já enviadas.")) e.preventDefault(); else setBatch({ ...batch, allowRepeats: e.target.checked }); }}
                      onChange={() => { }} // handled by onclick
                    />
                    <span>Permitir Duplicatas</span>
                  </label>
                </div>

                <button type="submit" className="btn accent full-width" disabled={!!progress}>
                  <Send size={16} /> {progress ? 'Processando...' : 'Iniciar Envio em Lote'}
                </button>

                {progress && (
                  <div className="progress-container">
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${Math.min(100, (progress.processed / progress.total) * 100)}%` }}
                      ></div>
                    </div>
                    <div className="progress-text">
                      Enviando item {progress.processed} de {progress.total}
                    </div>
                  </div>
                )}
              </form>
            </section>
          </div>

          {/* RIGHT COLUMN: Info */}
          <div className="right-col">

            {/* RULES LIST */}
            <section className="card rules-list">
              <div className="section-header">
                <h2>Regras Ativas</h2>
                <button className="btn icon-only secondary" onClick={fetchData}><RefreshCw size={16} /></button>
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th width="50">Status</th>
                      <th>Fluxo (De {'->'} Para)</th>
                      <th width="50"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule) => (
                      <tr key={rule.id} className={!rule.active ? 'inactive' : ''}>
                        <td>
                          <button
                            className={`status-btn ${rule.active ? 'active' : 'inactive'}`}
                            onClick={() => handleToggle(rule.id)}
                            title={rule.active ? "Desativar" : "Ativar"}
                          >
                            {rule.active ? <Power size={18} /> : <PowerOff size={18} />}
                          </button>
                        </td>
                        <td>
                          <div className="rule-title">{rule.title || 'Sem título'}</div>
                          <div className="flow">
                            <span className="source" title={rule.source_chat_id}>
                              {rule.source_title || 'ID: ' + rule.source_chat_id.toString().slice(0, 6) + '...'}
                            </span>
                            {rule.source_thread_id && <span className="thread-badge source-badge">Top:{rule.source_thread_id}</span>}

                            <ArrowRight size={14} className="arrow" />

                            <span className="target" title={rule.target_chat_id}>
                              {rule.target_title || 'ID: ' + rule.target_chat_id.toString().slice(0, 6) + '...'}
                            </span>
                            {rule.target_thread_id && <span className="thread-badge">#{rule.target_thread_id}</span>}
                          </div>
                        </td>
                        <td>
                          <button className="btn danger icon-only" onClick={() => handleDeleteRule(rule.id)} title="Excluir Regra">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {rules.length === 0 && (
                      <tr>
                        <td colSpan="3" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                          Nenhuma regra configurada.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* LOGS */}
            <section className="card logs">
              <div className="section-header">
                <h2>Logs do Sistema</h2>
                <div style={{ display: 'flex', gap: '5px' }}>
                  <button className="btn icon-only secondary small" onClick={() => setLogs([])} title="Limpar Logs"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="logs-container">
                {logs.length === 0 && <div style={{ color: '#64748b', textAlign: 'center', padding: '1rem' }}>Aguardando eventos...</div>}
                {logs.map((log, i) => (
                  <div key={i} className={`log-item ${log.type}`}>
                    <span className="time">{log.time}</span>
                    <span className="msg">{log.message}</span>
                  </div>
                ))}
              </div>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
