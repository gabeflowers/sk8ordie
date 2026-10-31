# sk8ordie

Jogo de skate 3D arcade para navegador, inspirado em *skate.* (EA). A física é própria e simplificada: o controle responde rápido e de forma previsível. A direção de arte atual é **"Estacionamento neon"**: estacionamento vazio à meia-noite, asfalto escuro, poças de luz de sódio e magenta em tudo que é skatável.

## O que dá para fazer hoje

- **Remar, frear e virar.** A velocidade sempre segue o shape, sem derrapar, e o corpo inclina para dentro da curva.
- **Flip tricks, grabs, manuals, powerslide e revert**, com pontuação e multiplicador por variedade, como no Skate 3 (ver abaixo).
- **Ollie e nollie.** Tem *coyote time* (ainda dá para pular logo depois de sair de uma borda) e *jump buffer* (o pulo apertado pouco antes de pousar vale).
- **Giro no ar.** Pousa limpo de frente ou de costas; de costas, segue andando de **fakie**. Só cai quem pousa atravessado.
- **Grind** nos corrimões e nas bordas dos caixotes, ledges e manual pads:
  - shape alinhado ao trilho → **50-50**;
  - shape atravessado → **boardslide**.
- **Tombo com física.** O corpo vira ragdoll e o shape solta do pé na direção do movimento; depois o skater levanta e o shape volta para o pé.
- **Painel de tuning** (lil-gui, só em dev). Ajusta física, câmera, luz e animação ao vivo e copia os valores em JSON para colar no `src/config.ts`.

### Controles

| Tecla | Ação |
|---|---|
| ↑ | remar |
| ↓ | frear |
| ← / → | virar (no chão) · girar (no ar) |
| segurar e soltar **Espaço** | ollie (quanto mais segura, mais alto) |
| segurar e soltar **Q** | nollie |
| R | voltar ao início |

**Flips** (inspirados no Flick-It do Skate 3): segure **A/D/S/W** enquanto solta o Espaço ou o Q.

| Teclas | Manobra |
|---|---|
| A | Kickflip |
| D | Heelflip |
| S | Pop Shove-it |
| W | FS Shove-it |
| A + S | Varial Kickflip |
| D + W | Varial Heelflip |
| A + W | Hardflip |
| D + S | Inward Heelflip |
| A duas vezes / D duas vezes | Double Kickflip / Double Heelflip |
| S duas vezes | 360 Shove-it |
| S duas vezes + A | 360 Flip |

- **Late flip:** aperte A/D/S/W logo depois de sair do chão, sem agachar.
- **Catch:** se o flip não terminar antes de pousar, o skater cai.
- **Giros:** girar o corpo no ar com ←/→ soma ao nome da manobra (FS/BS 180, 360…).

**Grabs** (no ar, segurando; segure a mão primeiro e depois W/S): **J** = mão da frente (Melon; +W Nosegrab; +S Mute), **L** = mão de trás (Indy; +S Tailgrab; +W Stalefish). Solte antes de pousar, senão é bail. Só dá para pegar o shape depois de o flip terminar.

**Manual:** em velocidade, toque **S** (manual) ou **W** (nose manual), ou pouse segurando S/W. O equilíbrio aparece numa barra e vai ficando mais difícil; corrija com W/S. Dê ollie para sair e continuar a linha.

**Powerslide:** **↓ + ←/→** em velocidade. Logo depois de pousar de costas (fakie), o mesmo comando faz um **revert** e volta a andar de frente.

Para trilhar: dê ollie e caia sobre um corrimão ou sobre a borda de um obstáculo, chegando quase paralelo a ele.

### Pontuação

Cada manobra pousada soma pontos à **linha**. O multiplicador é o número de manobras **diferentes** da linha, e repetir a mesma rende metade a cada vez. A linha fecha e entra no total depois de ~1 s rolando sem manobra; **cair zera a linha**. O recorde de linha fica salvo no navegador.

## Como rodar localmente

Pré-requisito: [Node.js](https://nodejs.org/) 22 ou mais novo (o projeto foi feito com o 24 LTS).

```bash
npm install
npm run dev
```

Abra o endereço que o Vite mostrar (normalmente http://localhost:5173).

### Outros comandos

| Comando | O que faz |
|---|---|
| `npm test` | roda os testes (Vitest) da física, do rig, do grind e do tombo |
| `npm run test:watch` | testes em modo observação |
| `npm run typecheck` | checagem de tipos (TypeScript strict) |
| `npm run build` | typecheck + build de produção em `dist/` (sem a lil-gui) |
| `npm run preview` | serve o build de produção localmente |

## Stack

- **[Vite](https://vite.dev/)** + **TypeScript** (strict)
- **[Three.js](https://threejs.org/)** para o render. Tudo é feito com primitivas e texturas geradas em canvas, sem assets externos.
- **Física própria**, cinemática e arcade, com passo fixo de 1/60 s. Não usa engine de física.
- **[lil-gui](https://lil-gui.georgealways.com/)** para o tuning ao vivo (só em dev)
- **[Vitest](https://vitest.dev/)** para os testes da simulação

## Estrutura

```
src/
  config.ts        todos os parâmetros de tuning (física, mundo, câmera, visual)
  main.ts          bootstrap
  core/            Game (loop fixo + render), Input (teclado), FixedStepper
  sim/             simulação pura, sem cena: SkaterSim, World, grind, aterrissagem
  render/          cena: cenário, skater (rig com IK), câmera, ragdoll, shape solto, faíscas
  dev/             painel de tuning (lil-gui)
tests/             testes da simulação e da física do visual
docs/              direção de arte (as 3 propostas e a escolhida)
```

A simulação (`src/sim`) não conhece o DOM nem a cena: recebe um estado de input e um `dt` fixo, e por isso é testável sem navegador. O render lê o estado da simulação e interpola entre os passos.
