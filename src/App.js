import logo from "./logo.svg";
import "./App.css";
import initSqlJs from "./sql-wasm.js";
import toSql from "./fp-to-sql";
import fhirpath from "fhirpath";
import { useEffect, useState } from "react";

let qDefault =
  "Concept.where(terms.IN.matches('acetaminophen')).select(rels.ingredient_of).select(rels.constitutes)";
if (window.location.hash.length > 1) {
  qDefault = window.location.hash.slice(1);
}
function App() {
  const [db, setDb] = useState(null);
  const [q, setQ] = useState(qDefault);
  const [qExecuting, setQExecuting] = useState(null);
  const [output, setOutput] = useState({});

  useEffect(async () => {
    let SQL = await initSqlJs();
    const dataFile = await fetch("/rxnorm-json.db").then((res) =>
      res.arrayBuffer()
    );
    setDb(new SQL.Database(new Uint8Array(dataFile)));
  }, []);

  useEffect(() => {
    let parsed, sql;
    try {
      parsed = fhirpath.parse(q);
      sql = toSql(parsed);
    } catch {}
    setOutput({parsed, sql, results: null, computing: false});
  }, [q]);
  
  useEffect(() => {
    if (!db || !qExecuting) {
      return;
    }
    setOutput({...output, computing: true});
    let cancel = false;
    setTimeout(()=>{
      let results = [];
      let t0 = new Date().getTime();
      let stmt = db.prepare(qExecuting);
      while (stmt.step()) {
        results.push(JSON.parse(stmt.get()[0]));
        if (results.length >= 500) break;
      }
      let t1 = new Date().getTime();
      let qTime = t1 - t0;
      !cancel && setOutput({
        ...output,
        results,
        qTime,
        computing: false
      });
    });
    return () => {
      cancel = true;
    }
  }, [db, qExecuting]);

  return (
    <div className="App">
      <input
        style={{ width: "100%" }}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <h3>Generated SQL</h3>
      <button disabled={!output.sql || output.computing} onClick={()=>{setQExecuting(output.sql)}}>Run SQL Query</button>
      <pre>{output?.sql}</pre>
      <h3>
        {output?.results?.length}
        {output?.results?.length === 500 ? "+" : ""} Results ({output.qTime}ms)
      </h3>
      <pre>{JSON.stringify(output.results || [], null, 2)}</pre>
      <h3>Parsed FHIRpath</h3>
      <pre>{JSON.stringify(output?.parsed || {}, null, 2)}</pre>
    </div>
  );
}

export default App;
