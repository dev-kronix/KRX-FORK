(() => {
  function parameterDefaults(route) {
    return Object.fromEntries(
      (route?.parameters || []).map((parameter) => [
        parameter.name,
        parameter.example === undefined ? '' : String(parameter.example),
      ]),
    );
  }
  function bodyDefault(route) {
    return route?.body?.example
      ? JSON.stringify(route.body.example, null, 2)
      : '';
  }
  function resolvedPath(route, values = parameterDefaults(route)) {
    let pathname = route.path;
    const query = new URLSearchParams();
    for (const parameter of route.parameters || []) {
      const value = values[parameter.name];
      if (parameter.in === 'path')
        pathname = pathname.replace(
          `:${parameter.name}`,
          encodeURIComponent(value || `:${parameter.name}`),
        );
      else if (
        parameter.in === 'query' &&
        value !== '' &&
        value !== undefined &&
        value !== null
      )
        query.set(parameter.name, String(value));
    }
    return query.size ? `${pathname}?${query}` : pathname;
  }
  const shellQuote = (value) =>
    "'" + String(value).replace(/'/g, "'\\''") + "'";
  function buildCodeSamples(route, options = {}) {
    const baseUrl = (options.baseUrl || 'https://krxdev.tech').replace(
      /\/$/,
      '',
    );
    const url = `${baseUrl}${resolvedPath(route, options.parameters || parameterDefaults(route))}`;
    const multipart = route.body?.format === 'multipart';
    const returnsJson = String(
      route.contentType || 'application/json',
    ).includes('json');
    const fileName =
      route.documentation?.outputFile ||
      `${route.id}.${returnsJson ? 'json' : 'bin'}`;
    let body;
    if (route.body && !multipart) {
      try {
        body = JSON.parse(options.bodyText || bodyDefault(route) || '{}');
      } catch {
        throw new Error('Corpo JSON inválido.');
      }
    }
    const headers = {
      Accept: returnsJson ? 'application/json' : route.contentType,
    };
    if (route.auth === 'apiKey') headers['x-api-key'] = 'SUA_CHAVE_KRX';
    if (route.auth === 'session')
      headers.Authorization = `Bearer ${'TOKEN_DA_SESSAO'}`;
    if (body) headers['Content-Type'] = 'application/json';
    const curlParts = [
      `curl --fail-with-body --max-time 90 --request ${route.method}`,
      `  --url ${shellQuote(url)}`,
    ];
    for (const [name, value] of Object.entries(headers))
      curlParts.push(`  --header ${shellQuote(`${name}: ${value}`)}`);
    if (body)
      curlParts.push(`  --data-raw ${shellQuote(JSON.stringify(body))}`);
    if (multipart)
      curlParts.push("  --form 'file=@./avatar.png;type=image/png'");
    if (!returnsJson) curlParts.push(`  --output ${shellQuote(fileName)}`);
    const fetchOptions = { method: route.method, headers };
    if (body) fetchOptions.body = JSON.stringify(body);
    let optionsCode = JSON.stringify(fetchOptions, null, 2);
    optionsCode =
      optionsCode.slice(0, -2) +
      `,\n  signal: AbortSignal.timeout(90000)${multipart ? ',\n  body: formData' : ''}\n}`;
    const imports = [
      !returnsJson && 'import { writeFile } from "node:fs/promises";',
      multipart && 'import { readFile } from "node:fs/promises";',
    ]
      .filter(Boolean)
      .join('\n');
    const upload = multipart
      ? 'const formData = new FormData();\nformData.append("file", new Blob([await readFile("./avatar.png")], { type: "image/png" }), "avatar.png");\n\n'
      : '';
    const request = `${imports ? imports + '\n\n' : ''}// Node.js 20+. ${route.name}\n${upload}const response = await fetch(${JSON.stringify(url)}, ${optionsCode});\n`;
    const path = route.documentation?.resultPath || 'data';
    const access =
      route.source === 'current'
        ? 'payload'
        : /^data(?:\.[A-Za-z0-9_]+)*$/.test(path)
          ? `payload.${path}`
          : 'payload.data';
    const jsonRead = `\nif (!response.headers.get("content-type")?.includes("application/json")) {\n  throw new Error("A API não retornou JSON. Verifique a disponibilidade do servidor.");\n}\nconst payload = await response.json();\nif (!response.ok || payload.success === false) {\n  throw new Error(payload.error?.message || \`Falha HTTP \${response.status}\`);\n}\n\nconst resultado = ${access};\nconsole.log(resultado);`;
    const family = String(route.contentType).split('/')[0];
    const binaryRead = `\nconst contentType = response.headers.get("content-type") || "";\nif (contentType.includes("application/json")) {\n  const error = await response.json();\n  throw new Error(error.error?.message || "A rota retornou JSON em vez de arquivo.");\n}\nif (!response.ok || !contentType.startsWith(${JSON.stringify(family + '/')})) {\n  throw new Error(\`Arquivo inválido: HTTP \${response.status}, \${contentType}\`);\n}\nconst arquivo = Buffer.from(await response.arrayBuffer());\nawait writeFile(${JSON.stringify(fileName)}, arquivo);\nconsole.log(${JSON.stringify(`Arquivo salvo em ${fileName}`)});`;
    const javascript = request + (returnsJson ? jsonRead : binaryRead);
    const pythonHead = `# Python 3. Instale: pip install requests\n${body ? 'import json\n' : ''}${!returnsJson ? 'from pathlib import Path\n' : ''}import requests\n\nurl = ${JSON.stringify(url)}\nheaders = ${JSON.stringify(headers)}\n`;
    let pythonRequest;
    if (multipart)
      pythonRequest = `with open("avatar.png", "rb") as arquivo:\n    response = requests.request(${JSON.stringify(route.method)}, url, headers=headers, files={"file": ("avatar.png", arquivo, "image/png")}, timeout=90)\n`;
    else
      pythonRequest = `${body ? `payload = json.loads(${JSON.stringify(JSON.stringify(body))})\n` : ''}response = requests.request(${JSON.stringify(route.method)}, url, headers=headers${body ? ', json=payload' : ''}, timeout=90)\n`;
    const pythonJson = `\nif "application/json" not in response.headers.get("content-type", ""):\n    raise RuntimeError("A API não retornou JSON")\npayload = response.json()\nif not response.ok or (isinstance(payload, dict) and payload.get("success") is False):\n    raise RuntimeError((payload.get("error") or {}).get("message", f"Falha HTTP {response.status_code}") if isinstance(payload, dict) else f"Falha HTTP {response.status_code}")\n\nresultado = payload${(route.source ===
    'current'
      ? []
      : path.split('.')
    )
      .map((part) => `[${JSON.stringify(part)}]`)
      .join('')}\nprint(resultado)`;
    const pythonBinary = `\ncontent_type = response.headers.get("content-type", "")\nif "application/json" in content_type:\n    payload = response.json()\n    raise RuntimeError(payload.get("error", {}).get("message", "A API não retornou um arquivo"))\nresponse.raise_for_status()\nif not content_type.startswith(${JSON.stringify(family + '/')}):\n    raise RuntimeError(f"Tipo de arquivo inesperado: {content_type}")\nPath(${JSON.stringify(fileName)}).write_bytes(response.content)\nprint(${JSON.stringify(`Arquivo salvo em ${fileName}`)})`;
    const response =
      route.documentation?.responseText ||
      JSON.stringify(
        route.documentation?.responseSchema || route.responses?.[0]?.example,
        null,
        2,
      ) ||
      'Consulte os campos da resposta abaixo.';
    return {
      url,
      curl: curlParts.join(' \\\n'),
      javascript,
      typescript: javascript.replace(
        '// Node.js 20+.',
        '// TypeScript com Node.js 20+ e @types/node.',
      ),
      python:
        pythonHead + pythonRequest + (returnsJson ? pythonJson : pythonBinary),
      response,
    };
  }

  function validateRequest(route, values, bodyText) {
    for (const p of route.parameters || []) {
      const value = values[p.name];
      if (
        p.required &&
        (value === undefined || value === null || String(value).trim() === '')
      )
        throw new Error('Preencha o parâmetro ' + p.name + '.');
      if (
        value !== '' &&
        value !== undefined &&
        ['integer', 'number'].includes(p.type) &&
        (!Number.isFinite(Number(value)) ||
          (p.type === 'integer' && !Number.isInteger(Number(value))))
      )
        throw new Error('Número inválido: ' + p.name + '.');
    }
    if (route.body && route.body.format !== 'multipart') {
      let body;
      try {
        body = JSON.parse(bodyText || '{}');
      } catch {
        throw new Error('Corpo JSON inválido.');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new Error('O corpo precisa ser um objeto JSON.');
      for (const f of route.body.fields || [])
        if (
          f.required &&
          (body[f.name] === undefined ||
            body[f.name] === null ||
            body[f.name] === '')
        )
          throw new Error('Preencha o campo ' + f.name + '.');
    }
  }
  const helpers = {
    parameterDefaults,
    bodyDefault,
    resolvedPath,
    buildCodeSamples,
    validateRequest,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  else window.KrxPlayground = helpers;
})();
