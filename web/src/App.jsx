import React, { useState, useEffect } from 'react';
import { Trash2, Plus, Power, PowerOff, Activity, Bot, RefreshCw, Layers, Send } from 'lucide-react';
import io from 'socket.io-client';
import './App.css';

const API_URL = '/api';
const socket = io();

function App() {
  const [rules, setRules] = useState([]);
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newRule, setNewRule] = useState({ source_chat_id: '', target_chat_id: '', title: '', target_thread_id: '', source_thread_id: '' });

  // Batch State
  const [batch, setBatch] = useState({ source_chat_id: '', target_chat_id: '', limit: 50, onlyAlbums: false, source_topic_id: '', target_thread_id: '', allowRepeats: false });
  const [mediaCount, setMediaCount] = useState(null);
  const [progress, setProgress] = useState(null);

  // Topics State
  const [ruleTargetTopics, setRuleTargetTopics] = useState([]);
  const [ruleSourceTopics, setRuleSourceTopics] = useState([]); // New
  const [batchSourceTopics, setBatchSourceTopics] = useState([]);
  const [batchTargetTopics, setBatchTargetTopics] = useState([]);

  const [botInfo, setBotInfo] = useState(null);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    fetchData();
    fetchBotInfo();

    socket.on('connect', () => {
      addLog({ message: '🔌 Conectado ao servidor de logs', type: 'system', time: new Date().toLocaleTimeString() });
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

  const fetchTopics = async (chatId, type) => {
    if (!chatId || chatId === 'custom') {
      if (type === 'ruleTarget') setRuleTargetTopics([]);
      if (type === 'ruleSource') setRuleSourceTopics([]);
      if (type === 'batchSource') setBatchSourceTopics([]);
      if (type === 'batchTarget') setBatchTargetTopics([]);
      return;
    }
    try {
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

  const fetchMediaCount = async (chatId) => {
    if (!chatId || chatId === 'custom') return setMediaCount(null);
    try {
      const res = await fetch(`${API_URL}/media-count/${chatId}`);
      const data = await res.json();
      setMediaCount(data.count);
    } catch (e) { console.error(e); }
  };

  // When Rule Target changes, fetch topics
  useEffect(() => {
    fetchTopics(newRule.target_chat_id, 'ruleTarget');
  }, [newRule.target_chat_id]);

  // When Rule Source changes, fetch topics
  useEffect(() => {
    fetchTopics(newRule.source_chat_id, 'ruleSource');
  }, [newRule.source_chat_id]);

  // When Batch Source/Target changes
  useEffect(() => {
    fetchTopics(batch.source_chat_id, 'batchSource');
  }, [batch.source_chat_id]);

  useEffect(() => {
    fetchTopics(batch.target_chat_id, 'batchTarget');
  }, [batch.target_chat_id]);


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
        addLog({ message: 'Regra adicionada', type: 'success', time: new Date().toLocaleTimeString() });
      }
    } catch (error) { console.error(error); }
  };

  const handleBatchForward = async (e) => {
    e.preventDefault();
    if (!window.confirm(`Confirmar envio de ${batch.limit} mídias?`)) return;
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
    if (!window.confirm('Tem certeza?')) return;
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

  const renderChatSelect = (value, onChange, placeholder = "Selecione...") => (
    <div className="input-group">
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (placeholder === 'source') fetchMediaCount(e.target.value);
        }}
      >
        <option value="">Selecione um grupo...</option>
        {chats.map(c => (
          <option key={c.chat_id} value={c.chat_id}>
            {c.title} ({c.type})
          </option>
        ))}
        <option value="custom">Outro (Inserir ID)</option>
      </select>
      {(!value || value === 'custom' || !chats.find(c => c.chat_id === value)) && (
        <input
          className="mt-2"
          type="text"
          placeholder="ID do Grupo (-100...)"
          value={value === 'custom' ? '' : value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );

  const renderTopicSelect = (value, onChange, topics, label) => (
    <div className="input-with-refresh">
      <select value={value} onChange={e => onChange(e.target.value)}>
        <option value="">{label || 'Todos / Geral'}</option>
        {topics.map(t => (
          <option key={t.topic_id} value={t.topic_id}>
            {t.name} (ID: {t.topic_id})
          </option>
        ))}
      </select>
      {/* Fallback to manual input if needed? Maybe just a small input below if select is empty/insufficient? 
               For now, let's allow typing ID if they select 'Custom' or just keep simple. 
               We'll add a small "OR Input ID" field if they want? 
               Let's keep it simple: Select or if you want manual, you can't via this UI unless we add "Custom" option.
               Let's add a small input for manual override if they want.
            */}
      <input
        type="number"
        placeholder="ID Manual"
        className="small-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        title="Ou digite o ID manualmente"
      />
    </div>
  );


  return (
    <div className="container">
      <header className="header">
        <h1><Activity className="icon" /> FanstamaBot <span className="badge">v2.1</span></h1>
        <div className="bot-status">
          {botInfo ? (
            <span className="online"><Bot size={16} /> @{botInfo.username} (Online)</span>
          ) : (
            <span className="offline">Offline</span>
          )}
        </div>
      </header>

      <div className="main-content">
        <div className="dashboard-grid">

          <div className="left-col">
            {/* Add Rule */}
            <section className="card">
              <h2><Plus size={20} /> Nova Regra Automática</h2>
              <form onSubmit={handleAddRule}>
                <div className="form-group">
                  <label>Título</label>
                  <input
                    type="text"
                    placeholder="Ex: Canal Vip"
                    value={newRule.title}
                    onChange={(e) => setNewRule({ ...newRule, title: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Origem (Doador)</label>
                  {renderChatSelect(newRule.source_chat_id, (v) => setNewRule({ ...newRule, source_chat_id: v }))}
                </div>
                <div className="form-group">
                  <label>Tópico Origem</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {renderTopicSelect(newRule.source_thread_id || '', (v) => setNewRule({ ...newRule, source_thread_id: v }), ruleSourceTopics, 'Todos / Geral')}
                    <button type="button" className="btn icon-only secondary small" onClick={() => fetchTopics(newRule.source_chat_id, 'ruleSource')} title="Atualizar Tópicos"><RefreshCw size={14} /></button>
                  </div>
                </div>
                <div className="form-group">
                  <label>Destino (Receptor)</label>
                  {renderChatSelect(newRule.target_chat_id, (v) => setNewRule({ ...newRule, target_chat_id: v }))}
                </div>
                <div className="form-group">
                  <label>Tópico Destino</label>
                  {/* Refresh Button Logic: Just re-trigger fetch? We can add a refresh icon next to label */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {renderTopicSelect(newRule.target_thread_id || '', (v) => setNewRule({ ...newRule, target_thread_id: v }), ruleTargetTopics, 'Geral (Nenhum)')}
                    <button type="button" className="btn icon-only secondary small" onClick={() => fetchTopics(newRule.target_chat_id, 'ruleTarget')} title="Atualizar Tópicos"><RefreshCw size={14} /></button>
                  </div>
                </div>
                <button type="submit" className="btn primary full-width">Adicionar Regra</button>
              </form>
            </section>

            {/* Batch Forward */}
            <section className="card batch-card">
              <h2><Layers size={20} /> Envio em Lote (Backup)</h2>
              <form onSubmit={handleBatchForward}>
                <div className="form-group">
                  <label>Origem (Onde estão as mídias)</label>
                  {renderChatSelect(batch.source_chat_id, (v) => setBatch({ ...batch, source_chat_id: v }), 'source')}
                  {mediaCount !== null && (
                    <div className="count-badge">📦 {mediaCount} mídias disponíveis</div>
                  )}
                </div>
                {batch.source_chat_id && (
                  <div className="form-group">
                    <label>Filtrar por Tópico (Origem)</label>
                    {renderTopicSelect(batch.source_topic_id || '', (v) => setBatch({ ...batch, source_topic_id: v }), batchSourceTopics, 'Todos os Tópicos')}
                  </div>
                )}

                <div className="form-group">
                  <label>Destino (Para onde enviar)</label>
                  {renderChatSelect(batch.target_chat_id, (v) => setBatch({ ...batch, target_chat_id: v }))}
                </div>
                {batch.target_chat_id && (
                  <div className="form-group">
                    <label>Enviar para Tópico (Destino)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      {renderTopicSelect(batch.target_thread_id || '', (v) => setBatch({ ...batch, target_thread_id: v }), batchTargetTopics, 'Geral (Nenhum)')}
                      <button type="button" className="btn icon-only secondary small" onClick={() => fetchTopics(batch.target_chat_id, 'batchTarget')} title="Atualizar Tópicos"><RefreshCw size={14} /></button>
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label>Quantidade (Últimas X mídias)</label>
                  <input
                    type="number" min="1" max="1000"
                    value={batch.limit}
                    onChange={(e) => setBatch({ ...batch, limit: parseInt(e.target.value) })}
                  />
                </div>

                <div className="form-group checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={batch.onlyAlbums}
                      onChange={(e) => setBatch({ ...batch, onlyAlbums: e.target.checked })}
                    />
                    <span>Enviar somentes Álbuns</span>
                  </label>
                </div>

                <div className="form-group checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={batch.allowRepeats}
                      onChange={(e) => setBatch({ ...batch, allowRepeats: e.target.checked })}
                    />
                    <span>Permitir Mídias Repetidas</span>
                  </label>
                </div>

                <button type="submit" className="btn accent full-width" disabled={!!progress}>
                  <Send size={16} /> {progress ? 'Enviando...' : 'Iniciar Envio'}
                </button>

                {progress && (
                  <div className="progress-container">
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${(progress.processed / progress.total) * 100}%` }}
                      ></div>
                    </div>
                    <div className="progress-text">
                      Enviando lote: {progress.processed} / {progress.total}
                    </div>
                  </div>
                )}
              </form>
            </section>
          </div>

          <div className="right-col">
            {/* Rules List */}
            <section className="card rules-list">
              <div className="section-header">
                <h2>Regras Ativas</h2>
                <button className="btn icon-only secondary" onClick={fetchData}><RefreshCw size={16} /></button>
              </div>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Fluxo</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule) => (
                      <tr key={rule.id} className={!rule.active ? 'inactive' : ''}>
                        <td>
                          <button
                            className={`status-btn ${rule.active ? 'active' : 'inactive'}`}
                            onClick={() => handleToggle(rule.id)}
                          >
                            {rule.active ? <Power size={18} /> : <PowerOff size={18} />}
                          </button>
                        </td>
                        <td>
                          <div className="flow">
                            <span className="source">{rule.source_title || rule.source_chat_id}</span>
                            {rule.source_thread_id && <span className="thread-badge source-badge">Top:{rule.source_thread_id}</span>}
                            <span className="arrow">➔</span>
                            <div className="target-container">
                              <span className="target">{rule.target_title || rule.target_chat_id}</span>
                              {rule.target_thread_id && <span className="thread-badge">#{rule.target_thread_id}</span>}
                            </div>
                          </div>
                          <div className="rule-title">{rule.title}</div>
                        </td>
                        <td>
                          <button className="btn danger icon-only" onClick={() => handleDeleteRule(rule.id)}>
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {rules.length === 0 && <tr><td colSpan="3" align="center">Nenhuma regra.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Logs */}
            <section className="card logs">
              <h2>Logs do Sistema</h2>
              <div className="logs-container">
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
