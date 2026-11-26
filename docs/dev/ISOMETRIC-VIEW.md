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
   estáveis, ordenados uma vez por `isoSort` e pintados num canvas só. Ela é refeita quando muda o conjunto de áreas
   ou o estado de um móvel (cafeteira passando café, cabine ocupada).
4. Entidades do quadro (personagens, telas dos monitores, itens de parede animados, props dinâmicos, carros e áreas
   em montagem), ordenadas por `isoSort`. Depois de cada uma, `redrawInFront` redesenha só os pedaços da camada que
   ficam na frente dela e cruzam o desenho, em cascata. Os candidatos vêm de uma grade de 64 px.
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

A arte desenha a frente para o sul. Para o leste, usa o espelho; para o norte, as costas lisas (`backView`); para o
oeste, o espelho das costas (`renderIsoFurniture(..., facing)`). O `client/src/world/layout/facing.test.ts` confere
em 48 salas e nas áreas comuns:

- cadeira e mesa do mesmo posto ficam frente a frente;
- cada assento olha para onde o móvel aponta;
- cadeiras de café e poltronas olham para a mesa mais próxima;
- móveis de parede ficam de costas para ela.

O `art/iso/iso.test.ts` confere o lado do encosto na arte, nas 4 direções.

Quem senta fica no centro do assento (`SEAT_SHIFT` desfaz o deslocamento que a planta antiga dava ao ponto do
assento) e usa a caixa do assento na ordem de desenho, entre a base e o `front`.

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

- Estático em cache: chão externo, pisos, camada de paredes/móveis, props da frente e mapa de luz projetado.
- Telas dos monitores (~7 vezes por segundo) e itens de parede animados ficam em canvas próprios. Abaixo de zoom 1,2,
  o ritmo cai para um terço.
- Redesenho na frente das entidades com grade espacial.
- Medido no modo demonstração (1680 x 915, prédio inteiro na tela): mediana de ~5 ms de CPU por quadro.

## Testes

`npx vitest run client/src/world/iso.test.ts client/src/art/iso client/src/art/character-iso` (projeção, ordem, kit,
todos os móveis em todas as variantes, paredes, elevador, carros, personagens), além de `npm run typecheck` e
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
git revert -m 1 <hash do merge>   # o hash está no fim deste documento e na memória da Bianca
npm run typecheck && npm run build
npm run docker:up                 # só com o ok do Reis
```

## Limitações conhecidas

- Paredes do fundo são opacas: quem anda junto à parede norte das salas do lado sul do corredor fica parcialmente
  atrás dela.
- Os brilhos da noite (monitores, luminárias) ainda são desenhados chapados no chão.
- A pintura gerada por IA sem moldura pronta cai no quadro procedural.
- As setas do teclado na Visita andam nos eixos do mundo (para cima = norte, que na tela é para cima à direita).
