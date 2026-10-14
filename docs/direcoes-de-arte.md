# Direção de arte v0.2: 3 propostas

Spec do agente `game-art-director` (`.claude/agents/game-art-director.md`). As prévias visuais estão no
canvas de Design "Skate Arcade — Direções de Arte".

**Convenções**
- Coordenadas no espaço local do `bodyPivot`: a origem é o topo do shape (y = 0,111 no root).
- +Z = nose, +Y = cima, −X = peito e bico do tênis (stance regular).
- Hex em sRGB, com NoToneMapping.

**Duas observações que valem para as três**
1. **A câmera vê o skater de perfil.** Por isso a pose é desenhada em XY:
   - joelhos para −X e quadril para +X;
   - tronco inclinado ~12°;
   - mão da frente à frente do peito, mão de trás atrás das costas.
2. **O fundo atrás do skater é o chão.** A câmera olha 10,5° para baixo, então o contraste que conta é skater × chão:
   - **A:** escuro sobre claro;
   - **B:** frio sobre quente médio;
   - **C:** claro sobre escuro.

---

## A: "Laje" (silhueta tipo Vector)

Telhado de prédio numa tarde de bruma branca. Skater quase preto e recortado, e um único laranja-vermelho em tudo
que é skatável. Referências: Vector, Mirror's Edge, Smash Hit.

**Assinaturas**
1. Skater a ~12% de valor sobre chão a ~80%. Sola e rodas brancas marcam o contato com o shape.
2. Acento único #FF5A36, só em peças finas de 4–6 cm: cantoneira, corrimão, réguas de borda.
3. Skyline em 3 anéis, cada um mais claro que o anterior: dá profundidade sem depender de fog.
4. Sombras curtas e nítidas (sol a 67°), cinza-claras.
5. Chão quase liso: juntas a cada 2 m e um ralo escuro a cada 8 m.

| item | hex |
|---|---|
| céu topo / horizonte | #BCD3E2 / #EEF1EF |
| fog (near 40, far 150) | #EAEEEC |
| chão base / lajes | #CDD0D3 / #D1D4D6 · #C9CCD0 · #CFD2D5 · #C7CACE |
| juntas / borda de laje / ralo | #A7ACB1 / #9BA1A7 / #7D848B |
| concreto / caixa técnica / grelha | #E4E6E7 / #F0F1F2 / #8E959C |
| metal do fundo | #A9B0B6 |
| pele / moletom / gorro / calça | #3A3532 / #1F2228 / #2B2F36 / #353A42 |
| tênis / sola | #16181C / #EEEEEA |
| shape lateral / base | #17181A / #FF5A36 |
| rodas / truck | #F1EFE8 / #A9B0B6 |
| acento | #FF5A36 |
| skyline perto / meio / longe | #B4BEC6 / #C9D1D7 / #DCE2E6 |

**Luz**
- Hemi: céu #FFFFFF, chão #9AA0A6, intensidade 1,6.
- Sol: #FFF4E6, intensidade 2,4, offset (6, 24, 10).
- Sombra: extent 14, map 2048 (1024 no mobile), bias −0,0004, normalBias 0,02.

**Personagem: moletom + jogger + gorro.** 13 meshes, MeshStandard (roughness 0,9) com vertexColors, radialSegments 12.

| peça | primitiva (m) |
|---|---|
| tronco | Cylinder r 0,175 (ombro) → 0,135 (quadril), h 0,56, profundidade × 0,62 |
| capuz abaixado | Sphere r 0,10, escala (prof 0,65, alt 0,6, larg 1,1), nas costas |
| pescoço | Capsule r 0,05, L 0,10 |
| cabeça | Sphere escalada para 0,20 × 0,234 × 0,156 |
| gorro | Sphere r 0,106 com θ de 0 a 0,55π, escala Y 1,25 |
| braço / antebraço | Capsule r 0,05, L 0,30 / Capsule r 0,04, L 0,30 + mão Sphere r 0,045 |
| coxa / canela | Capsule r 0,07, L 0,43 / Capsule r 0,056, L 0,43 |
| tênis | Box 0,28 × 0,075 × 0,11 + sola Box 0,285 × 0,025 × 0,115 |

**Kit**
- **Ledge:** mureta/floreira de concreto com cantoneira na cor de acento.
- **Manual pad:** base de máquina com réguas de borda na cor de acento.
- **Caixote:** caixa técnica com faixa de grelha nas 4 laterais.
- **Corrimão:** guarda-corpo na cor de acento.
- **Limite do mapa:** mureta de 1 m em ±60, #D9DCDF.

**Chão** (canvas 1024 px = 8 m)
1. 4 lajes de 4 × 4 m nas 4 cores de laje.
2. 300 manchas radiais (alpha 0,04).
3. 6000 pontos.
4. Juntas de 2 m (3 px #A7ACB1) e bordas de laje de 4 m (6 px #9BA1A7).
5. Um ralo de 0,30 m por tile.

**Fundo:** 3 anéis de blocos (r 85–100 / 120–145 / 170–200 m) em MeshBasic sem fog, num merge.

**Custo:** ~36 draw calls, contando a sombra.

**Riscos**
- High-key pode parecer vazio: manter o hemi em no máximo 1,8.
- Membros sobrepostos no perfil: manter o contraste moletom × calça.
- Acento só em peças finas.
- Chão iluminado abaixo de 90% de valor.

---

## B: "Pátio dourado" (golden hour)

Fim de tarde num pátio de escola. Sol laranja baixo, sombras longas azuladas, low-poly facetado. A camiseta cobalto é
a única cor fria. Referências: Alto's Adventure, Crossy Road, Skate City.

**Assinaturas**
1. Sol a 25°: sombras ~2× mais longas e listras de postes e árvores no chão.
2. Quente × frio: luz direta #FFB36B, sombras azuladas pelo hemi #9FC2E3.
3. flatShading com radialSegments 7 no personagem e copas em icosaedro.
4. Amarelo de segurança #F2B632 em tudo que é skatável.
5. Quadra pintada no chão e faixa de pavers a cada 8 m.

| item | hex |
|---|---|
| céu topo / horizonte / fog | #7FA7CC / #FFCF98 / #F2C39A (near 30, far 120) |
| chão / placas | #B9A68E / #BFAC94 · #B4A189 · #BBA890 · #B09D85 |
| juntas / pavers / tijolinho / quadra | #8F7C67 / #A08B72 / #8D7962 / #F0E4C6 |
| concreto / madeira / pranchas | #CBB99C / #B37B4B / #8E5E38 |
| metal | #9A978F |
| pele / camiseta / cargo e bucket | #B97A52 / #2A4F8F / #3A3631 |
| tênis / sola gum | #EFE8DA / #B5793F |
| shape (maple) / lixa | #D8B27A / #1C1C1C |
| rodas / truck | #F4E9D0 / #B9BCBF |
| acento | #F2B632 |
| prédio / janela / copa / tronco / alambrado | #E5CDA4 / #8C6F52 / #7C8A47 / #5E4632 / #6F6A62 |

**Luz**
- Hemi: céu #9FC2E3, chão #8A5B3D, intensidade 1,0.
- Sol: #FFB36B, intensidade 3,2, offset (−16, 9, 10).
- Sombra: extent 20, bias −0,0006, normalBias 0,035.

**Personagem: camiseta oversized + cargo largo + bucket.** 13 meshes, flatShading.
- **Tronco:** Cylinder r 0,18 → 0,175, h 0,60.
- **Mangas:** Cylinder r 0,075, L 0,20, mais braço de pele.
- **Canela de boca larga:** Cylinder r 0,078 → 0,09.
- **Bucket:** copa Cylinder r 0,085 → 0,105, h 0,09, mais aba r 0,105 → 0,155, inclinada 10°.

**Kit**
- **Ledge:** banco-floreira de concreto com cantoneira amarela.
- **Caixote:** compensado com pranchas de 0,15 m.
- **Corrimão:** pintado de amarelo.
- **Banco de praça (opcional):** 1,8 × 0,45 × 0,45.

**Chão**
1. 16 placas de 2 × 2 m.
2. Manchas e fissuras.
3. Juntas de 2 m.
4. Faixa de pavers de 0,40 m na borda do tile.

**Decalque de quadra:** 28 × 15 m, polygonOffset −2.

**Fundo**
- Escola: 60 × 7 × 10 m, em z +72.
- 14 árvores em icosaedro, a 64–78 m.
- 10 postes e alambrado em ±61.

**Custo:** ~43 draw calls.

**Riscos**
- Acne e peter-panning com sol baixo: ajustar o bias ao vivo.
- O amarelo pode puxar para laranja: alternativa #FFD23F.
- Árvores em icosaedro só a 60 m ou mais.
- Decalque sem polygonOffset dá z-fight.

---

## C: "Estacionamento neon" (noite)

Estacionamento vazio à meia-noite. Asfalto escuro, poças de luz de sódio, bordas magenta em tudo que é skatável e
um skater de moletom claro com rodas de LED. Referências: Jet Set Radio (fases noturnas), Hotline Miami.

**Assinaturas**
1. Skater claro (#E7E2D6) sobre asfalto a ~15% de valor.
2. Rodas de LED magenta (MeshBasic) como marcador do jogador.
3. Cantoneiras, réguas e corrimão em magenta chapado, sem bloom.
4. Poças de luz de sódio assadas num lightMap, sob postes que existem na cena.
5. Vagas pintadas, faixa amarela tracejada e viaduto em silhueta.

| item | hex |
|---|---|
| céu topo / horizonte / fog | #070B1C / #2B2148 / #1E1A33 (near 18, far 90) |
| asfalto / ruído | #2A2C31 / #24262B a #33363B |
| vagas / faixa / óleo | #D6D3C6 / #D4AD3C / #1B1C20 |
| concreto / compensado / metal | #5B5F69 / #3D4250 / #3B3F47 |
| pele / moletom / calça / mochila | #C8946B / #E7E2D6 / #6A6F79 / #B8BFCC |
| tênis / sola | #18181C / #F2F2F2 |
| shape / lixa | #1A1A1F / #111114 |
| rodas (emissivas) / truck | #FF2E88 / #6D717A |
| acento | #FF2E88 |
| poça / luminária | #FFB766 / #FFE3B3 |
| skyline / janelas | #141329 / #FFCF7A (70%) · #8FC8FF (30%) |

**Luz**
- Hemi: céu #34406E, chão #15121C, intensidade 0,5.
- Lua (com sombra): #A9BCFF, intensidade 1,1, offset (−8, 20, 12).
- Contraluz (sem sombra): #FF7AB8, intensidade 1,2, atrás do skater em relação à câmera. O `WorldView.update` precisa receber a direção da câmera.
- Poças: lightMap de 512 px cobrindo o mapa.
- Fase 2: uma PointLight que acompanha o poste mais próximo.

**Personagem: moletom com capuz levantado + calça larga + mochila + tênis de cano alto.** 12 meshes de corpo.
- **Capuz:** substitui a cabeça (Sphere r 0,125).
- **Mochila:** Box 0,12 × 0,34 × 0,26, nas costas.

**Kit**
- Ledge e ilha de concreto com cantoneira magenta.
- Caixote de compensado pintado.
- Corrimão em tubo magenta.
- **Poste de luz (colidível):** AABB 0,25 × 0,25 × 6.
  - 2 sobre as ilhas: (−6; 25,5) e (16; 15).
  - 2 em áreas livres: (−10; 10) e (20; −6).
  - 12 nos limites, sem AABB.

**Chão** (1024 px = 10 m)
1. Ruído de asfalto.
2. Vagas de 2,5 m.
3. Faixa amarela tracejada (traço de 1,5 m, vão de 1,0 m).
4. Manchas de óleo.
5. Desgaste de ~15% das linhas.

**Fundo:** 30 blocos de skyline, viaduto de 200 × 1,5 × 12 m em z +110, 400 janelas instanciadas e alambrado.

**Custo:** ~40 draw calls.

**Riscos**
- Tela escura no celular: não descer o asfalto abaixo de #2A2C31 nem o hemi abaixo de 0,45.
- Sem bloom, o neon é só cor chapada.
- As poças são estáticas.
- Postes colidíveis ficam fora das linhas de passagem.
- Fog curto: se esconder obstáculos, subir o far para 110.

---

## Base comum às 3

### R: rig do personagem
Proporção de 1,78 m em pé (7,6 cabeças). Na pose base, o topo da cabeça fica ~1,70 m acima do shape, abaixo do horizonte, então a câmera não muda.

**Comprimentos**
- tornozelo: 0,08 acima do topo do shape;
- canela 0,43 e coxa 0,43;
- quadril: ±0,09 em Z;
- coluna (quadril → base do pescoço): 0,50;
- ombros: ±0,19 em Z, 0,04 abaixo da base do pescoço;
- pescoço 0,10; centro da cabeça 0,12 acima do topo do pescoço;
- braço 0,30 e antebraço 0,30.

**Pés e joelhos**
- Tornozelos na base: (0,04; 0,08; ±0,21). O `stanceHalf` passa de 0,17 para 0,21.
- O tênis da frente gira 15° com o bico para o nose.
- Joelhos por IK analítico de 2 ossos (lei dos cossenos), com polo em −X. Na base ficam em ≈ (−0,10; 0,48; ±0,15).

| parâmetro | base | aterrissagem | ar | bail |
|---|---|---|---|---|
| quadril (x; y) | 0,06; 0,88 | 0,10; 0,72 | 0,08; 0,68 | 0,02; 0,90 |
| inclinação do tronco | 12° | 26° | 20° | 35° |
| torção para o nose | 15° | 10° | 20° | 0° |
| cabeça: yaw / pitch | 70° / 10° | 70° / 20° | 60° / 25° | 0° / 0° |
| cotovelo F − ombro F | −0,06; −0,25; +0,15 | −0,10; −0,22; +0,17 | −0,08; −0,10; +0,26 | −0,24; −0,12; +0,10 |
| mão F − cotovelo F | −0,13; −0,24; +0,23 | −0,16; −0,14; +0,25 | −0,10; +0,12; +0,30 | −0,30; −0,06; +0,08 |
| cotovelo B − ombro B | +0,07; −0,26; −0,14 | +0,10; −0,22; −0,16 | +0,10; −0,12; −0,25 | −0,22; −0,14; −0,10 |
| mão B − cotovelo B | +0,16; −0,23; −0,23 | +0,18; −0,14; −0,25 | +0,22; +0,04; −0,28 | −0,30; −0,08; −0,06 |

Os vetores de braço são direções: normalizar cada um para 0,30.

**Tronco:** `q = Euler(0, torção, inclinação, 'YXZ')`. Base do pescoço = quadril + q·(0; 0,50; 0).

**Mistura por frame:** interpolar base → ar → aterrissagem → bail.
- **Ar:** peso amortecido até 1 em AIRBORNE (λ 12).
- **Aterrissagem:** o mesmo `pulse(crouchTime)` de hoje. O agachamento passa a ser o quadril descendo, em vez de `scale.y`.
- **Bail:** peso amortecido até 1 em BAILED (λ 10). A queda continua em `bodyPivot.rotation.z`.
- **Curva:** mãos sobem 0,12·|lean/leanMax|.
- **Pop:** os tornozelos-alvo vêm de marcadores filhos do deck (footF/footB), misturados por footLock = 1 − peso do bail. O pé da frente sobe com o nose e o shape deixa de atravessar a perna.

**Hierarquia**
```
root ─ boardLean ─ popPivot ─ deck (1 mesh mesclado + marcadores footF/footB)
     └ bodyPivot (inalterado) ─ rig (Group) ─ 12–13 meshes irmãos
```
- Cada segmento usa `CapsuleGeometry(r, L).translate(0, L/2, 0)`.
- Por frame: position = junta A e quaternion = `setFromUnitVectors(+Y, B−A)`.

**Shape:** um merge com prancha 0,20 × 0,03 × 0,54, kicktails de 0,14 m a 18°, trucks e 4 rodas, com vertexColors. Em C as rodas viram um mesh separado, por serem emissivas.

### K: kit e colisão (o visual nunca passa da AABB)

| peça | dimensões (m) | AABB | regra visual |
|---|---|---|---|
| ledge | 0,6–0,8 × 6–12 × 0,40–0,55 | inteira | corpo recuado 5 mm; cantoneira 0,04 × 0,04 nas arestas longas |
| manual pad | 3–4 × 6–8 × 0,30–0,35 | inteira | réguas de borda de 0,06, polygonOffset −2 |
| caixote | 2–3 × 3–4 × 0,30–0,60 | inteira | réguas de 0,05 no topo |
| corrimão | tubo Ø 0,048, topo a 0,45–0,50, L 6; postes Ø 0,042 a cada 2 m; pontas curvas r 0,10 | 0,06 × (L + 0,05) × topo | tudo dentro da AABB |

**Mapeamento do mapa atual**
- caixote: (0,16), (10,38), (−14,8), (0,−12);
- ledge: (5,24), (0,46), (−18,34);
- manual pad: (−6,22), (16,12);
- novos rails: R1 em x −9, z 34, ao longo de Z, topo 0,50; R2 em x 14, z 26, ao longo de X, topo 0,45.

**Rail no curto prazo: AABB fina.** Bater de lado a mais de 6 m/s derruba o skater, o ollie passa por cima com folga, e cair em cima vira um 50-50 acidental. Deixar o rail só visual não serve: o skater atravessaria o tubo.

**O que o grind exige depois**
1. Um `RailDef {x0, z0, x1, z1, top}` separado de `boxes`. As cantoneiras dos ledges viram trilhos derivados.
2. Novo estado GRINDING. Snap quando todas valem:
   - AIRBORNE com vy ≤ 0;
   - o pé entre top − 0,10 e top + 0,15;
   - distância em XZ até o segmento de no máximo 0,30;
   - ângulo de até 30° (50-50) ou 90° ± 25° (boardslide).
3. Durante o grind: posição projetada no segmento, velocidade na tangente, atrito ~1,5 m/s², yaw travado. Sai no fim do trilho, com ollie ou com bail.
4. Ignorar a AABB do rail na colisão lateral enquanto estiver em grind.
5. Visual: pose de grind, shape a 90° no boardslide e faíscas (InstancedMesh, 1 draw).
6. Corrimão de escada: o mesmo segmento com y0 ≠ y1, mais degraus como AABBs.

### Render e config
- **Merge estático por material** (`mergeGeometries`), com vertexColors. Substitui os 9 meshes + 9 LineSegments de hoje.
- **Céu em cúpula:** `SphereGeometry(260, 24, 12)` com BackSide, vertexColors e fog:false. `fog.color` = cor do horizonte.
- **Chão:** `PlaneGeometry(120, 120, 24, 24)` com vertexColor de 0,94–1,0 para quebrar a repetição. Linhas com pelo menos 3 px. O grid atual fica atrás de uma flag na lil-gui.
- **Config:**
  - `BoxDef.color` vira `kind`;
  - novos `visual.palette` (A, B ou C), `visual.rig`, `visual.outfit` e `visual.ground`;
  - `visual.lights` passa a ter valores por direção.
- **Orçamento:** ~36–43 draw calls, contra um teto de 100. ~4k triângulos no skater e ~15k no ambiente.
