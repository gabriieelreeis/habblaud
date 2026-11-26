# Visão isométrica do escritório

O escritório é desenhado em visão isométrica 2:1, no estilo dos hotéis isométricos em pixel art: câmera de sudeste,
piso em losangos, paredes do fundo (norte e oeste) com quadros, TV e janelas, móveis e personagens vistos em 3/4.
Toda a arte é desenhada por código e é original.

A simulação não mudou. Salas, caminhos, assentos, agentes, servidor e o que vai para o Habblaud World continuam no
plano visto de cima (px de mundo, `TILE` = 16 por tile). Mudaram só o desenho, a câmera e os cliques. A cena da cidade
do Habblaud World (`client/src/world/city/`) continua 2D, com câmera e desenho próprios.

## Mapa dos arquivos

| O quê | Onde |
| --- | --- |
| Projeção, ordem de desenho, ordenação topológica | `client/src/world/iso.ts` (+ `iso.test.ts`) |
| Renderizador por quadro | `client/src/world/render/renderer.ts` |
| Visuais de uma área: piso projetado, paredes fatiadas, itens de parede | `client/src/world/render/iso-area.ts` |
| Textos em espaço de tela (placas, pílulas, balões, contorno da sala) | `client/src/world/render/overlay.ts` |
| Luz da noite (mapa projetado e paredes) | `client/src/world/render/lighting.ts` (`drawAmbientIso`) |
| Câmera, visão geral, foco, cliques | `client/src/world/index.ts` (`buildingRect`, `focusRoom`, `pick`, `roomAt`) |
| Kit de desenho isométrico (caixas, faces, cilindros) | `client/src/art/iso/kit.ts` |
| Móveis | `client/src/art/iso/office.ts`, `office2.ts`, `cafe.ts`, `lounge.ts`; despacho em `iso/index.ts` |
| Paredes, elevador, carros | `client/src/art/iso/walls.ts`, `elevator.ts`, `car.ts` |
| Personagens | `client/src/art/character-iso/` (`render.ts` é a entrada) |
| Contrato da arte (funções opcionais `iso*`) | `client/src/art/api.ts` |

## Projeção e coordenadas

```
ix = x − y
iy = (x + y) / 2 − z
```

`x`, `y` são px de mundo no chão; `z` é a altura em px de tela. Um tile vira um losango de 32 x 16. A volta para o
chão é `fromIso(ix, iy)`. Para desenhar algo chapado no chão (piso, tapete, tom vermelho do alarme, tiles na
montagem da sala), basta desenhar em px de mundo sob `ctx.transform(...FLOOR_MATRIX, 0, 0)`.

A câmera (`client/src/world/camera.ts`) não mudou: ela só amplia e desloca um plano 2D. No escritório, esse plano é
o isométrico. Então `camera.screenToWorld` devolve coordenadas isométricas (use `fromIso` para chegar ao chão), e
`renderer.heads`, `renderer.tvRects`, `signRect` e `paintingRect` estão no plano isométrico. Balões, nomes, perguntas,
celular e a cena Visita leem a posição da cabeça na tela por `screenPositionOf`, sem saber da projeção.

## Ordem de desenho

1. Grama de fundo e o chão externo projetado uma vez (grama, calçada, rua, pátios dos lotes), com os props de trás
   do prédio já pintados (`buildBase`).
2. Pisos das áreas (`iso.floor`, projetado uma vez por área). Na montagem da sala, os tiles aparecem um a um sob a
   matriz do chão.
3. Camada estática (`layerFor`): fatias de parede, móveis, encostos e fachadas dos lotes vazios de todas as áreas
   estáveis, ordenados uma vez por `isoSort` e pintados UMA vez, com o dono de cada pixel (ver "Camadas e
   profundidade"). Ela só é refeita quando muda o conjunto de áreas (sala nova, sala que fecha, tema).
4. Entidades do quadro (personagens, telas dos monitores, cafeteira e cabine, itens de parede animados, props
   dinâmicos, carros e áreas em montagem), ordenadas por `isoSort` entre si e desenhadas por cima da camada; onde o
   cenário fica na frente de uma delas, os pixels da própria camada entram por cima dela (`paintMasked`).
5. Props da frente do prédio (sul e leste), pinguepongue, teias, partículas.
6. Luz: mapa da noite, salas apagadas (o volume da sala escurece) e brilhos. Depois as luzinhas de época, o
   giroflex do alarme e os ícones sobre as cabeças.

### Quem fica na frente

Cada coisa desenhável tem uma caixa no chão (`Box`, px de mundo). `boxOrder` decide pela separação das caixas: quem
tem x ou y maiores, sem sobrepor, fica na frente. Quando as caixas se cruzam (quem senta dentro do assento, item
pendurado na parede), o desempate é a profundidade do centro mais o `bias`:

| bias | o quê |
| --- | --- |
| 0 | base do móvel, fatia de parede |
| 0,25 | tela animada do monitor/fliperama (sobre a própria mesa) |
| 0,5 | personagem |
| 1 | `front` do móvel (encosto ao sul/leste, porta da cabine): por cima de quem senta |
| 100 | item animado na parede do fundo (sempre à frente das fatias da própria parede) |

## Camadas e profundidade

O cenário é pintado uma vez só, na abertura, e nunca é redesenhado por causa de quem passa (`client/src/world/render/compose.ts`):

- `composeLayer(order)`: mistura, em JavaScript, os pixels de cada pedaço (já na ordem do `isoSort`) num buffer RGBA
  do tamanho da camada e grava, por pixel, o DONO: o índice do último pedaço com alfa ≥ 128 ali (`OWNER_ALPHA`;
  sombras e vidro bem claro não viram donos). O buffer vira o canvas da camada (`putImageData`); a cor e o mapa de
  donos (`Uint16Array`) ficam em memória (no prédio de 7 colunas, 15 MB e 7,6 MB). Os pixels de cada sprite são lidos
  uma vez (`pixelsOf`).
- A cada quadro, para cada entidade: `markFront` marca os pedaços da camada que cruzam o desenho dela e ficam na
  frente pela ordem das caixas (`drawsBefore`, a mesma regra da ordenação; a grade de 64 px acha os candidatos). Sem
  nada na frente, ela vai direto para o quadro. Com algo na frente:
  1. `frontPixels` monta, da memória, o recorte da camada só com os pixels cujo dono está marcado (sem ler pixels
     de volta da placa de vídeo, o que faria a CPU esperar a GPU a cada pessoa andando);
  2. a entidade é desenhada num canvas próprio, alinhado aos pixels da tela (o mesmo desenho que sairia direto);
  3. o recorte entra por cima com `source-atop`, só onde ela tem pixel, e o resultado vai para o quadro.
  O recorte fica em cache enquanto o retângulo e os pedaços da frente não mudam; o desenho da entidade, enquanto a
  assinatura dela (sprite, posição, anel, transparência), os pedaços da frente e a câmera não mudam.
- Resultado: o quadro é igual ao cenário vazio em todo pixel em que a entidade não pinta. Atrás de um móvel alto some
  só a parte coberta; na frente, a pessoa aparece inteira; atrás de vidro (garrafão do bebedouro, divisória de
  vidro), ela aparece através dele e o vidro não muda quando ela passa (antes, devolver o recorte inteiro misturava o
  vidro duas vezes). `compose.test.ts` confere com a arte e as plantas de verdade, em centenas de posições no
  corredor dos bebedouros (com as salas dos dois lados, muretas e portas), na copa e em salas.
- A cafeteira e a cabine do banheiro mudam de desenho com o uso: ficam fora da camada, como entidades.
- O antigo redesenho em cascata dos móveis na frente de cada personagem (vindo do PR #204, `redrawSet`) saiu; de lá
  ficaram só `layerProps`/`isStaticProp` (props do lado de fora pintados uma vez). Era ele que fazia o desenho mudar
  conforme a posição de quem passava (a planta atrás da mureta do bebedouro, por exemplo, voltava por cima dela).
- Onde fica cada parede no plano (`wallPlan`, em `wall-plan.ts`) é puro: o renderizador e o teste usam o mesmo.

Desempenho, comparado com o `reiscorp/local` no mesmo procedimento (modo demonstração, 1920 x 945, 60 s de
aquecimento e 3 rodadas de 25 s em cada vista): mediana de CPU por quadro numa sala, 3,7 → 3,1 ms; no prédio inteiro à
noite, 4,6 → 3,7 ms. A cauda (p90) é parecida nas duas versões e vem da geração do sprite de um personagem na primeira
vez que cada pose e direção aparecem (5 a 20 ms cada); com isso aquecido, a sala fica em 1,9 ms de mediana e 2,9 ms
de p90. A montagem da camada, só na abertura e quando o prédio muda, leva de 40 a 70 ms no navegador (prédio de 7
colunas, 653 pedaços, 2694 x 1410 px: no Node, 2 ms de ordenação e 32 ms de pintura).

## Paredes

Os segmentos do layout continuam os mesmos (`face`, `south`, `cap`) e viram:

- `face` (a antiga face da parede norte, de 2 tiles): parede alta (`WALL_H` = 64 px) voltada para o sul, com o plano
  no rodapé antigo (`y + 32`). As duas linhas da face antiga viram chão de corredor na frente dela.
- `cap` vertical do lado oeste da área: parede alta voltada para o leste. Do lado leste: mureta baixa.
- `south` e `cap` horizontal: mureta baixa (`LOW_WALL_H` = 10 px), as "paredes da frente cortadas".
- Vãos de porta (`doorways`) saem vazados até `DOOR_H` (58 px), com batentes.

Cada parede vira um sprite (`art.isoWall`) cortado em fatias de 1 tile, cada fatia com a sua caixa. Quadros, pôsteres
e prateleiras são pintados inclinados no canvas da parede antes do corte (`bakeItem`). Janela, relógio, quadro
kanban, TV, placa, espelho, interruptor e elevador são entidades por quadro (`WallOverlay`). A arte deles é a de
sempre, de frente, pintada num canvas próprio e inclinada no plano da parede (`shearMatrix`). Esse canvas só é refeito
quando o conteúdo muda ou no ritmo da animação (`OVERLAY_PERIOD`). `wallLift` sobe cada item na parede, que é mais alta
que a face antiga.

## Direção dos móveis

A vista de cima mostrava tudo de frente para a câmera. Aqui a direção de cada móvel sai de uma função só,
`furnitureFacing` (`client/src/world/layout/facing.ts`), a partir da planta:

1. Assentos com a direção na variante (cadeira de café, poltrona, sofá): a variante é para onde quem senta olha.
2. Posto de trabalho: a `office_chair` olha para o norte, para a `desk` (tela para o sul); a `office_chair_front` olha
   para o sul, para a `desk_back` (tela para o norte).
3. Móveis de parede (`WALL_FACING`: estantes, arquivo, impressora, bebedouro, bancadas, geladeira, máquinas, pia,
   fliperama, cabine): ficam de costas para a parede que tocam, na ordem norte, oeste, leste e sul.
4. O resto não tem frente.

O pufe não tem a direção na variante (é a cor): ele olha para onde aponta o lugar que o usa.

A arte desenha a frente para o sul. Para o leste, usa o espelho; para o norte, as costas desenhadas de cada móvel de
parede (`BACKS` em `client/src/art/iso/index.ts`, lista em `ISO_BACK_KINDS`: estantes com a lateral aberta e as
pastas, impressora com bandeja e cabos, arquivo, bebedouro, geladeira, máquina de venda, bancadas, pia, cafeteira,
micro-ondas, fliperama e cabine); para o oeste, o espelho das costas (`renderIsoFurniture(..., facing)`). A cabine do
banheiro fica sempre com a porta fechada: estado 0 com a luz verde (livre) e 1 com a vermelha (ocupada). O
`client/src/world/layout/facing.test.ts` confere em 48 salas e nas áreas comuns:

- cadeira e mesa do mesmo posto ficam frente a frente;
- cada assento olha para onde o móvel aponta;
- cadeiras de café e poltronas olham para a mesa mais próxima;
- móveis de parede ficam de costas para ela.

O `art/iso/iso.test.ts` confere o lado do encosto na arte, nas 4 direções; `art/iso/backs.test.ts`, que todo móvel
de parede da planta tem costas próprias e que a cabine livre e a ocupada só diferem na luz.

### Quem senta

O ponto do assento na planta vai para o centro do tile (`SEAT_SHIFT` desfaz o deslocamento que a planta antiga
dava). Dali, `art.isoSeatAnchor(kind, variante, direção)` (`client/src/art/iso/seats.ts`) diz onde fica o quadril e
quanto o boneco sobe: a altura do quadril (topo da almofada + 1,5) menos `SEAT_HIP_Z` (11,5, o quadril do personagem
sentado). Cadeira de café, poltrona e sofá puxam o quadril para longe do encosto (0,75, 1,5 e 2 px); banco e banqueta
sobem 2 px; o pufe afunda 4,5 px. Quem senta usa a caixa do assento na ordem de desenho, entre a base e o `front`,
só enquanto está junto dele.

O que fica do lado de cá de quem senta vai no `front` (por cima dele): o encosto e o braço ao sul ou ao leste da
poltrona e do sofá, o encosto da cadeira de café, a borda da frente do pufe virado para o norte (os próprios pixels
do pufe abaixo da cova: vazio, ele não muda). Prévia em PNG, sem navegador: `npx tsx scripts/seat-preview.ts <pasta>`
(assentos com pessoas nas 4 direções, costas dos móveis e cabines); testes em `art/iso/seats.test.ts`.

## Como acrescentar ou mudar um móvel

1. Desenhe com o kit (`Iso`): `new Iso(w, h, alturaLivre)` cria a folha com a origem no canto de trás (noroeste) do
   footprint. Use `box`, `top`, `south`, `east`, `cyl`, `disc`, `blob`, `line`, `shadow`. O contorno sai em
   `finish()`. Luz: topo claro, face sul média, face leste escura (`rampMat`).
2. A âncora (`ax`, `ay`) é o canto de trás do footprint. O renderizador põe esse ponto em `isoX/isoY` do canto
   `(tx, ty)` do móvel, somando o `dx/dy` da colocação.
3. O que fica na frente de quem senta ou entra (encosto ao sul ou ao leste, porta da cabine) vai no `front`.
4. Telas animadas: `southRect('screen', ...)` ou `eastRect(...)` registram o retângulo com `skew`. O renderizador
   desenha `drawScreen` de frente e inclina.
5. Ligue o kind no despacho (`client/src/art/iso/index.ts`) e ajuste `ISO_HEIGHT` (a caixa provisória usa).
6. Confira em PNG, sem navegador: `npx tsx scripts/iso-preview.ts <pasta> <kind...>`. Carros e elevador:
   `npx tsx scripts/iso-extra-preview.ts <pasta>`. Testes: `npx vitest run client/src/art/iso`.

Um kind sem desenho próprio sai como uma caixa neutra do tamanho do footprint: o mundo nunca fica sem o móvel. Os
enfeites de época (árvore de Natal, presentes, abóboras) continuam sprites de frente, no centro do footprint da
planta que substituem.

## Personagens

- Entrada: `renderIsoCharacter(req)` em `client/src/art/character-iso/render.ts`, exposta como
  `art.isoCharacterSprite`. A folha tem 32 x 52 e a âncora fica no centro dos pés (16, 47). Em pé o personagem tem
  ~40 px, com a cabeça em ~1/4 da altura. Sentado, o quadril fica em z ≈ 11 (o assento está em `SEAT_Z` = 10).
- Direções no plano do mundo: `down` (+y) olha para baixo-esquerda na tela, `right` (+x) para baixo-direita, `up`
  para cima-direita, `left` para cima-esquerda. São duas vistas desenhadas (frente-3/4 e costas-3/4), espelhadas.
- Mesmas poses, itens, roupas, penteados, acessórios e fantasias de época da arte antiga, que continua em uso no
  avatar da interface e na cidade do World.
- Prévia: `npx tsx scripts/char-iso-preview.ts` (gera folhas por pose e o elenco).

## Onde ajustar

- Câmera: zoom do foco na sala e no agente (`focusRoom` e `focusAgent` em `client/src/world/index.ts`), limites
  (`updateBounds`), enquadramento da visão geral (`overviewFrame` em `camera.ts`).
- Alturas: `WALL_H`, `LOW_WALL_H` e `WALL_T` em `client/src/world/iso.ts`; `DOOR_H` em `art/iso/walls.ts`;
  `wallLift` em `iso-area.ts`; `DESK_Z` e `SEAT_Z` em `art/iso/office.ts`.
- Ícones sobre a cabeça, anéis, teias: `drawCharacter`, `drawRing`, `drawCobwebs` em `renderer.ts`.

## Luz da noite

O mapa de luz continua sendo feito no plano de mundo (`paintMap`). `drawAmbientIso` projeta esse mapa no plano
isométrico quando ele muda. Depois pinta cada parede do fundo com a faixa do mapa logo à frente dela, para a parede de
uma sala acesa não pegar a escuridão de fora, que fica atrás dela na tela. A cada quadro, um recorte do tamanho da vista é
multiplicado sobre a cena. Os brilhos (monitores, luminárias, faróis) ainda são desenhados no plano do chão.

## Desempenho

- Estático em cache: chão externo, pisos, camada de paredes/móveis (com o dono de cada pixel), props da frente e
  mapa de luz projetado.
- Telas dos monitores (~7 vezes por segundo) e itens de parede animados ficam em canvas próprios. Abaixo de zoom 1,2,
  o ritmo cai para um terço.
- Cenário na frente das entidades pelo mapa de donos, com grade espacial e recortes em cache (ver "Camadas e
  profundidade", onde estão os números medidos).

## Testes

`npx vitest run client/src/world/iso.test.ts client/src/world/render client/src/art/iso client/src/art/character-iso`
(projeção, ordem, camada com dono por pixel, kit, todos os móveis em todas as variantes, costas, assentos, paredes,
elevador, carros, personagens), além de `npm run typecheck` e
`npm run build`. A conferência visual é no servidor de desenvolvimento com `?mock=1`. Para rodar sem mexer no
escritório do Docker, use outra porta: `VITE_PORT=5788 npx vite --config vite.config.ts`. Para ver os dados reais em
outra porta e numa pasta de dados à parte, sem World, mensagens e linha do tempo:
`HABBLAUD_PORT=4790 HABBLAUD_DATA_DIR=<pasta> HABBLAUD_WORLD=0 HABBLAUD_MENSAGENS=0 HABBLAUD_TIMELINE=0 npx tsx server/index.ts --dev`.
A depuração no console: `habblaud.world.debug.lookAtRoom(nome, zoom)`, `.setHour(21.5)`,
`.roomEffect(nome, 'party' | 'alarm')`.

## Como reverter

A visão entrou em `reiscorp/local` num único merge `--no-ff` da branch `feature/visao-isometrica`. Para voltar à
vista de cima:

```sh
# o hash do merge também está na memória da Bianca e na apresentação 2026-11-26-0120-visao-hotel da TV
git revert -m 1 $(git log reiscorp/local --merges --format=%h -n 1 --grep="feature/visao-isometrica")
npm run typecheck && npm run build
npm run docker:up                 # só com o ok do Reis
```

As correções de camadas, assentos, costas e cabines vieram num segundo merge `--no-ff`, da branch
`fix/visao-isometrica-camadas`. Para desfazer só elas (antes de desfazer a visão inteira, se for o caso):

```sh
git revert -m 1 $(git log reiscorp/local --merges --format=%h -n 1 --grep="fix/visao-isometrica-camadas")
```

## Limitações conhecidas

- Paredes do fundo são opacas: quem anda junto à parede norte das salas do lado sul do corredor fica parcialmente
  atrás dela.
- Os brilhos da noite (monitores, luminárias) ainda são desenhados chapados no chão.
- O primeiro quadro em que um personagem aparece numa pose e direção novas gera o sprite dele (5 a 20 ms); é daí que
  vêm os quadros lentos de vez em quando, nas duas versões.
- A ordem pelas caixas é aproximada para quem está colado numa parede ou no batente de uma porta (dentro da espessura
  dela): o desempate é a profundidade do centro.
- A pintura gerada por IA sem moldura pronta cai no quadro procedural.
- As setas do teclado na Visita andam nos eixos do mundo (para cima = norte, que na tela é para cima à direita).
