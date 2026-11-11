# XEQUE.ONLINE — Xadrez multiplayer para navegador

Aplicativo web de xadrez para **2 pessoas em tempo real**, com código/link de convite, sem cadastro. Peças e movimentos são sincronizados por Socket.IO. Os lances são validados no servidor com `chess.js` (xeque, xeque-mate, roque, en passant, promoção e empates).

## O que está incluído

- Nome obrigatório antes de criar ou entrar em uma sala.
- Salas com 6 caracteres e convite por link; branco cria e preto entra.
- Exibição do jogador da vez; situação de xeque, xeque-mate, empate e histórico dos lances.
- Casas disponíveis **com contorno espesso verde** e capturas **com contorno espesso vermelho**; peça selecionada com borda dourada.
- Fundo preto ou branco; escolha salva no navegador.
- Barra de transparência inferior de 0 a 100%, deixando a interface do jogo invisível quando zerada. A barra permanece acessível para restaurar a interface.
- Descanso de tela após 30 segundos sem interação, com **imagem SVG ilustrativa** da página inicial de pesquisa do Google. Clique/toque para voltar ao jogo.
- Promoção de peão, histórico SAN, orientação do tabuleiro para as cores de cada jogador e botão de revanche com confirmação de ambos.
- Responsivo para desktop, tablets e celulares.

## Rodar no computador

Requer **Node.js 20 ou superior**.

```bash
npm install
npm start
```

Acesse http://localhost:3000. Para testar os dois jogadores, abra em duas abas (cada aba tem identidade própria) ou em dois dispositivos que consigam acessar o servidor.

## Publicar no Render

1. Crie um repositório no GitHub contendo a **pasta interna** do ZIP: `server.js`, `package.json`, `public/` e demais arquivos na raiz do repositório.
2. No Render: **New → Web Service**, conecte esse repositório.
3. Runtime: **Node**. Build Command: `npm install`. Start Command: `npm start`.
4. Configure apenas **1 instância**, porque salas e partidas são mantidas em memória, sem banco de dados.
5. Publique e compartilhe o link de convite. O Render fornece `PORT` automaticamente.

O arquivo `render.yaml` também permite criar o serviço usando um **Blueprint** do Render.

**Atenção:** publicar como *Static Site* ou apenas GitHub Pages não permite o multiplayer, pois o projeto precisa de um servidor Node.js. Use **Web Service**.

## Limitações

- As salas e partidas são temporárias e se perdem quando o servidor reinicia/adormece (por exemplo, em planos gratuitos).
- A reserva de vaga de um participante desconectado expira em aproximadamente 2 minutos. Passado esse tempo, o outro participante pode receber uma nova pessoa na mesma sala, com partida reiniciada.
- Para muitas partidas simultâneas ou escalabilidade com mais instâncias, adicionar Redis + adapter do Socket.IO e persistir os jogos em um banco de dados.
- A tela de pesquisa em descanso de tela é uma **ilustração estática** feita em SVG, não uma página real nem um formulário de coleta de dados.

## Estrutura

```text
server.js             Servidor Express, salas e validação das jogadas
public/index.html     Interface
public/styles.css     Temas, tabuleiro, contornos e responsividade
public/client.js      Renderização, ações, rede, transparência e inatividade
public/google-preview.svg   Imagem local do descanso de tela
public/favicon.svg
```
