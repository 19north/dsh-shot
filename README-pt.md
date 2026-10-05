# dsh-shot — captura de tela no compositor

> [English](./README.md) · [中文](./README-zh.md) · [Español](./README-es.md) ·
> **Português** · [हिन्दी](./README-hi.md)
>
> Tradução **parcial**: a referência completa é [README.md](./README.md); o registro de
> implementação e decisões está em [DESIGN.md](./DESIGN.md). Os títulos ficam em inglês para que
> as cinco versões possam ser comparadas.

Adiciona um botão de câmera ao lado de `＋` no compositor do DeepSeek Harness, com duas opções:
**captura direta** (captura toda a tela virtual imediatamente) e **ocultar esta janela** (oculta a
janela do DSH, captura e a restaura **exatamente** como estava, inclusive se estivesse
minimizada).

## Requirements

- DeepSeek Harness `0.1.7` ou mais recente, perfil desktop/web.
- Windows: a captura usa PowerShell + Win32.
- Node `^22.19.0 || >=24.0.0`.
- **Sem dependências de execução**: a metade de host importa apenas módulos `node:*`.

## Install

```sh
dsh plugin --profile <profile> add ./dsh-shot              # do código-fonte
dsh plugin --profile <profile> add ./dsh-shot-0.1.0.tgz    # de um tarball (pnpm pack)
```

Reinicie o aplicativo: a revisão do bundle do cliente é calculada na inicialização, então
recarregar a página não basta.

## Use

1. Clique no botão de câmera ao lado de `＋` e escolha uma das duas opções.
2. A camada cobre a janela: **arraste um retângulo** para selecionar uma região.
3. Anote se quiser e confirme; a imagem entra no rascunho do compositor.

| Ação | Efeito |
|---|---|
| Arrastar as **oito alças** (cantos e pontos médios) | Redimensiona a partir daquela alça. |
| Arrastar **dentro** do retângulo | Move o retângulo sem mudar o tamanho. |
| **Setas** do teclado | Ajusta um pixel; com **Shift**, dez. |
| **Clique direito** / **Reselecionar** | Descarta a seleção e recomeça. |
| **Esc** / clique direito | Volta um nível (desfazer anotação → reselecionar → sair). |

Ferramentas: **retângulo**, **seta**, **texto** (clique em um ponto, digite e pressione **Enter**;
**Esc** cancela; **duplo clique edita** o texto existente), paleta de **oito cores**, **desfazer**
e **reselecionar**. O texto tem uma placa escura translúcida para continuar legível sobre
qualquer fundo.

## How it fits together

| Metade | Arquivo | Executa em |
|---|---|---|
| Host | `lib/index.js` | Servidor do DSH; registra as rotas `/api/dsh-shot/*` e inicia `scripts/capture.ps1`. |
| Cliente | `lib/client.js` | Navegador; o botão do compositor e a camada de seleção/anotação. |
| Captura | `scripts/capture.ps1` | Processo PowerShell separado; localiza a janela do DSH, oculta/restaura e captura a tela virtual. |

A metade de cliente é declarada em `package.json` sob `dsh.client` e servida em
`/plugins/dsh-shot/client.js`.

## Known limitations

- **Somente Windows**: a captura usa PowerShell + Win32.
- A camada cobre a **janela**, não a tela: a captura é escalada para preencher a janela, então o
  que não corresponde à proporção é cortado. Vários monitores são tratados como uma única tela
  virtual e uma janela pequena não alcança todos os cantos.
- O modo ocultar faz o DSH desaparecer por cerca de 0,3 a 1,2 s.
- Raramente o script de captura devolve um quadro quase vazio; repetir a captura funciona.

## Development

```sh
dsh-plugin-dev check --cwd .     # verificações estáticas do contrato
dsh-plugin-dev verify --cwd .    # empacota e instala/inicia/desinstala em um DSH_HOME temporário
```

As suítes de regressão sem interface ficam fora do pacote (`dsh-screenshot-research/`).

## License

MIT.
