import { MathUtils } from 'three';

// Todos os parâmetros de tuning do jogo. Unidades: metros, segundos, radianos.
// O objeto é mutável de propósito: a lil-gui (dev) altera os valores ao vivo.
// Direção de arte: opção C "Estacionamento neon" (docs/direcoes-de-arte.md).

/** Volume sólido do mapa (AABB). Centro em XZ, base no chão (y = 0). */
export interface SolidDef {
  x: number;
  z: number;
  sizeX: number;
  sizeZ: number;
  height: number;
}

export type BoxKind = 'ledge' | 'pad' | 'crate' | 'step';

/** Obstáculo skatável; `kind` só muda o visual. */
export interface BoxDef extends SolidDef {
  kind: BoxKind;
}

/** Corrimão reto com topo em `top`, centrado em (x, z), ao longo de `axis`. */
export interface RailDef {
  x: number;
  z: number;
  length: number;
  axis: 'x' | 'z';
  top: number;
  /** altura do topo na ponta + do eixo (corrimão de escada); sem isso, reto */
  topEnd?: number;
}

/**
 * Rampa em cunha (kicker/bank): a altura sobe de 0 até `height` ao longo de `dir`;
 * a ponta alta (lip) lança o skater.
 */
export interface RampDef {
  x: number;
  z: number;
  /** largura (perpendicular a dir) e comprimento (ao longo de dir) */
  width: number;
  length: number;
  height: number;
  dir: 'x+' | 'x-' | 'z+' | 'z-';
}

/** Poste de luz; `armYaw` é a direção do braço da luminária (mesma convenção do yaw do skater). */
export interface PoleDef {
  x: number;
  z: number;
  armYaw: number;
}

export type Vec3Tuple = [number, number, number];

/**
 * Pose-chave do rig (tabela R). Ângulos em radianos; vetores de braço são direções
 * no espaço do bodyPivot (normalizadas para o comprimento do osso).
 */
export interface PoseParams {
  hipX: number;
  hipY: number;
  /** inclinação do tronco: +Y → −X (peito) */
  lean: number;
  /** torção: peito → nose */
  twist: number;
  headYaw: number;
  headPitch: number;
  elbowF: Vec3Tuple;
  handF: Vec3Tuple;
  elbowB: Vec3Tuple;
  handB: Vec3Tuple;
}

const deg = MathUtils.degToRad;

// o bail não tem pose-chave: o corpo vira ragdoll (visual.bail)
const POSES: Record<'base' | 'landing' | 'air' | 'grind' | 'push' | 'grab', PoseParams> = {
  // grab: joelhos no peito, tronco dobrado em direção ao shape (as mãos vão por IK)
  grab: {
    hipX: 0.06, hipY: 0.62, lean: deg(40), twist: deg(10), headYaw: deg(55), headPitch: deg(30),
    elbowF: [-0.1, -0.2, 0.2], handF: [-0.1, -0.2, 0.2],
    elbowB: [-0.1, -0.2, -0.2], handB: [-0.1, -0.2, -0.2],
  },
  // remada: vira o tronco para o nose, desce o quadril sobre o pé da frente e deixa os braços soltos
  push: {
    hipX: -0.08, hipY: 0.76, lean: deg(18), twist: deg(70), headYaw: deg(85), headPitch: deg(15),
    elbowF: [0.04, -0.28, 0.06], handF: [0.02, -0.26, 0.12],
    elbowB: [-0.04, -0.28, -0.04], handB: [-0.02, -0.27, 0.06],
  },
  // grind: quadril baixo, braços abertos na altura do ombro para equilíbrio
  grind: {
    hipX: 0.06, hipY: 0.76, lean: deg(18), twist: deg(10), headYaw: deg(75), headPitch: deg(22),
    elbowF: [-0.04, -0.06, 0.3], handF: [-0.02, 0.02, 0.3],
    elbowB: [0.04, -0.06, -0.3], handB: [0.02, 0.02, -0.3],
  },
  base: {
    hipX: 0.06, hipY: 0.88, lean: deg(16), twist: deg(15), headYaw: deg(70), headPitch: deg(10),
    elbowF: [-0.06, -0.25, 0.15], handF: [-0.13, -0.24, 0.23],
    elbowB: [0.07, -0.26, -0.14], handB: [0.16, -0.23, -0.23],
  },
  landing: {
    hipX: 0.1, hipY: 0.72, lean: deg(26), twist: deg(10), headYaw: deg(70), headPitch: deg(20),
    elbowF: [-0.1, -0.22, 0.17], handF: [-0.16, -0.14, 0.25],
    elbowB: [0.1, -0.22, -0.16], handB: [0.18, -0.14, -0.25],
  },
  air: {
    hipX: 0.08, hipY: 0.64, lean: deg(20), twist: deg(20), headYaw: deg(60), headPitch: deg(25),
    elbowF: [-0.08, -0.1, 0.26], handF: [-0.1, 0.12, 0.3],
    elbowB: [0.1, -0.12, -0.25], handB: [0.22, 0.04, -0.28],
  },
};

// escadaria: plataforma de 0,45 m, dois degraus descendo para +Z e um bank de acesso
const STAIRS: BoxDef[] = [
  { x: 30, z: 14, sizeX: 6, sizeZ: 6, height: 0.45, kind: 'pad' },
  { x: 30, z: 17.35, sizeX: 6, sizeZ: 0.7, height: 0.3, kind: 'step' },
  { x: 30, z: 18.05, sizeX: 6, sizeZ: 0.7, height: 0.15, kind: 'step' },
];

// Spawn em (0, 0, 0) olhando para +Z; a área em volta fica livre.
const BOXES: BoxDef[] = [
  { x: 0, z: 16, sizeX: 2.5, sizeZ: 4, height: 0.3, kind: 'crate' },
  { x: 5, z: 24, sizeX: 0.7, sizeZ: 12, height: 0.45, kind: 'ledge' },
  { x: -6, z: 22, sizeX: 3.5, sizeZ: 8, height: 0.3, kind: 'pad' },
  { x: 10, z: 38, sizeX: 3, sizeZ: 3, height: 0.6, kind: 'crate' },
  { x: 0, z: 46, sizeX: 12, sizeZ: 0.8, height: 0.4, kind: 'ledge' },
  { x: -14, z: 8, sizeX: 2, sizeZ: 3, height: 0.5, kind: 'crate' },
  { x: 16, z: 12, sizeX: 4, sizeZ: 7, height: 0.35, kind: 'pad' },
  { x: -18, z: 34, sizeX: 0.6, sizeZ: 10, height: 0.55, kind: 'ledge' },
  { x: 0, z: -12, sizeX: 3, sizeZ: 3, height: 0.45, kind: 'crate' },
  ...STAIRS,
];

const RAILS: RailDef[] = [
  { x: -9, z: 34, length: 6, axis: 'z', top: 0.5 },
  { x: 14, z: 26, length: 6, axis: 'x', top: 0.45 },
  // corrimão da escadaria: começa sobre a plataforma e desce até o chão
  { x: 27.8, z: 18.1, length: 3.4, axis: 'z', top: 0.95, topEnd: 0.5 },
];


const RAMPS: RampDef[] = [
  // bank que sobe até a plataforma da escadaria
  { x: 30, z: 8, width: 6, length: 6, height: 0.45, dir: 'z+' },
  // kickers
  { x: 0, z: 30, width: 2.2, length: 1.6, height: 0.45, dir: 'z+' },
  { x: -30, z: 15, width: 2.2, length: 1.6, height: 0.5, dir: 'z+' },
];

// postes colidíveis: 2 sobre as ilhas (manual pads), 2 em áreas livres
const POLES: PoleDef[] = [
  { x: -6, z: 25.5, armYaw: Math.PI / 2 },
  { x: 16, z: 15, armYaw: -Math.PI / 2 },
  { x: -10, z: 10, armYaw: Math.PI / 2 },
  { x: 20, z: -6, armYaw: -Math.PI / 2 },
];

export const CONFIG = {
  loop: {
    fixedDt: 1 / 60,
    maxStepsPerFrame: 5,
    /** dt máximo de um frame (ex.: ao voltar de aba inativa) */
    maxFrameDt: 0.1,
  },

  sim: {
    maxPushSpeed: 7,
    maxSpeed: 12,
    pushAccel: 5,
    brakeDecel: 8,
    rollingFriction: 0.6,
    turnRateSlow: 2.5,
    turnRateFast: 1.5,
    gravity: 22,
    ollieVelocity: 6.5,
    airSpinRate: 6,
    landingTolerance: MathUtils.degToRad(35),
    /** abaixo disso a aterrissagem é limpa em qualquer ângulo */
    landingMinSpeed: 0.5,
    coyoteTime: 0.1,
    jumpBuffer: 0.12,
    bailResetTime: 1.5,
    bailImpactSpeed: 6,
    /** desaceleração horizontal durante o bail */
    bailDecel: 6,
    skaterRadius: 0.3,
    stepTolerance: 0.05,
    /** distância (m) para medir a inclinação do chão à frente e atrás do skater */
    slopeProbe: 0.2,
    /** quanto da subida da rampa vira impulso vertical no lip e no ollie */
    rampLaunch: 1.4,
    spawnX: 0,
    spawnZ: 0,
    spawnYaw: 0,
    // grind: corrimões e arestas do topo das caixas (src/sim/grind.ts)
    /** janela vertical do pé para engatar: de y − grindSnapBelow a y + grindSnapAbove */
    grindSnapBelow: 0.1,
    grindSnapAbove: 0.15,
    /** distância máxima em XZ do centro do skater até o segmento */
    grindSnapDistance: 0.3,
    /** ângulo máximo entre a velocidade horizontal e o segmento (qualquer sentido) */
    grindMaxApproachAngle: MathUtils.degToRad(45),
    /** shape até esse ângulo do segmento (módulo 180°): 50-50 */
    grindFiftyFiftyAngle: MathUtils.degToRad(30),
    /** shape a 90° ± isso do segmento: boardslide */
    grindBoardslideTolerance: MathUtils.degToRad(25),
    /** velocidade mínima ao longo do segmento para engatar */
    grindMinSpeed: 1.5,
    /** abaixo disso o skater cai do trilho (menor que grindMinSpeed: histerese) */
    grindExitSpeed: 0.75,
    /** desaceleração ao longo do trilho (m/s²) */
    grindFriction: 1.5,

    /** Manobras (inspiradas no Flick-It do Skate 3, adaptado ao teclado). */
    tricks: {
      /** segurar o pop até isso (s) dá a altura máxima; um toque rápido dá minPopFactor */
      chargeTime: 0.35,
      minPopFactor: 0.75,
      /** depois de sair do chão, ainda dá para começar um flip (late flip) até isso (s) */
      lateWindow: 0.3,
      /** pousar com o flip abaixo dessa fração = não pegou o shape → bail */
      catchThreshold: 0.8,
      /** duas batidas na mesma tecla durante o agachamento = versão "double" */
      doubleTap: 2,
      /** giro do corpo: tolerância (rad) para contar como 180/360/... */
      spinTolerance: MathUtils.degToRad(40),
      ollie: { name: 'Ollie', points: 50 },
      spinPointsPer180: 150,
      airPointsPerSecond: 80,
      nollieFactor: 1.3,
      fakieFactor: 1.15,
      lateFactor: 1.25,
      /**
       * Flips: `flip` = voltas no eixo longo (+ = kickflip), `shove` = meias-voltas em Y
       * (+ = backside), `duration` = tempo da rotação no ar (s).
       */
      catalog: {
        kickflip: { name: 'Kickflip', points: 300, duration: 0.42, flip: 1, shove: 0 },
        heelflip: { name: 'Heelflip', points: 300, duration: 0.42, flip: -1, shove: 0 },
        popShove: { name: 'Pop Shove-it', points: 250, duration: 0.36, flip: 0, shove: 1 },
        fsShove: { name: 'FS Shove-it', points: 250, duration: 0.36, flip: 0, shove: -1 },
        varialKickflip: { name: 'Varial Kickflip', points: 500, duration: 0.46, flip: 1, shove: 1 },
        varialHeelflip: { name: 'Varial Heelflip', points: 500, duration: 0.46, flip: -1, shove: -1 },
        hardflip: { name: 'Hardflip', points: 600, duration: 0.48, flip: 1, shove: -1 },
        inwardHeelflip: { name: 'Inward Heelflip', points: 600, duration: 0.48, flip: -1, shove: 1 },
        treFlip: { name: '360 Flip', points: 800, duration: 0.52, flip: 1, shove: 2 },
        shove360: { name: '360 Shove-it', points: 550, duration: 0.46, flip: 0, shove: 2 },
        doubleKickflip: { name: 'Double Kickflip', points: 700, duration: 0.5, flip: 2, shove: 0 },
        doubleHeelflip: { name: 'Double Heelflip', points: 700, duration: 0.5, flip: -2, shove: 0 },
      },

      /**
       * Grabs: J = mão da frente, L = mão de trás; W/S seguradas escolhem a variação.
       * Pousar ainda segurando = bail. Pontos: base + tempo segurado.
       */
      grabs: {
        melon: { name: 'Melon', points: 200 },
        nosegrab: { name: 'Nosegrab', points: 250 },
        mute: { name: 'Mute', points: 200 },
        indy: { name: 'Indy', points: 200 },
        tailgrab: { name: 'Tailgrab', points: 250 },
        stalefish: { name: 'Stalefish', points: 300 },
      },
      grabPointsPerSecond: 300,

      /** Manual (S) e nose manual (W): equilíbrio instável, corrigido com W/S. */
      manual: {
        minSpeed: 1.2,
        /** abaixo disso o manual (e o powerslide) acabam */
        exitSpeed: 0.6,
        /** desequilíbrio inicial, para o lado do manual */
        startBalance: 0.15,
        /** o desequilíbrio se amplifica (1/s²) e fica mais difícil com o tempo */
        instability: 3,
        instabilityGrowth: 0.5,
        /** aceleração das correções com W/S */
        correction: 7,
        damping: 1.5,
        /** girar em manual é mais lento */
        turnFactor: 0.5,
        names: { tail: 'Manual', nose: 'Nose Manual' },
        points: 150,
        pointsPerSecond: 200,
      },

      /** Powerslide (↓ + ←/→ em velocidade) e revert (o mesmo logo depois de pousar fakie). */
      powerslide: {
        minSpeed: 3,
        decel: 9,
        minTime: 0.25,
        name: 'Powerslide',
        points: 150,
        revertWindow: 0.4,
        revertName: 'Revert',
        revertPoints: 200,
      },
    },

    /** Pontuação estilo Skate 3: multiplicador sobe a cada manobra única da linha; bail zera. */
    score: {
      /** rolando no chão sem manobra por isso (s), a linha fecha e os pontos entram no total */
      comboTimeout: 1.2,
      /** repetir a mesma manobra na linha rende cada vez menos */
      repeatFactor: 0.5,
      grindBasePoints: 150,
      grindPointsPerSecond: 250,
      /** variações de grind: nome e multiplicador sobre a pontuação do grind */
      grindVariants: {
        '5050': { name: '50-50', factor: 1 },
        fiveO: { name: '5-0', factor: 1.2 },
        nosegrind: { name: 'Nosegrind', factor: 1.3 },
        smith: { name: 'Smith', factor: 1.5 },
        feeble: { name: 'Feeble', factor: 1.5 },
        crooked: { name: 'Crooked', factor: 1.6 },
        boardslide: { name: 'Boardslide', factor: 1.2 },
        noseslide: { name: 'Noseslide', factor: 1.4 },
        tailslide: { name: 'Tailslide', factor: 1.4 },
        lipslide: { name: 'Lipslide', factor: 1.5 },
      },
    },
  },

  world: {
    size: 120,
    boxes: BOXES,
    rails: RAILS,
    poles: POLES,
    ramps: RAMPS,
    /** numa rampa, o chão pode subir até isso acima do pé num passo (subir a cunha rápido) */
    rampTolerance: 0.25,
    /** AABB do corrimão: largura e folga além do comprimento em cada ponta */
    railCollisionWidth: 0.06,
    railEndMargin: 0.025,
    /** corrimão de escada: cada pedaço da colisão sobe no máximo isso (menor que stepTolerance) */
    railPieceRise: 0.04,
    /** AABB do poste de luz */
    poleSize: 0.25,
    poleHeight: 6,
  },

  camera: {
    camDistance: 5,
    camHeight: 2.2,
    camLookAhead: 2,
    /** altura do ponto olhado acima do pé do skater */
    camLookHeight: 0.9,
    camDamping: 6,
    camLookDamping: 12,
    fovMin: 60,
    fovMax: 68,
    near: 0.1,
    far: 300,
    /** no ar, abaixo dessa velocidade a câmera mantém o heading anterior */
    minHeadingSpeed: 0.5,
  },

  visual: {
    maxPixelRatio: 2,
    /** mostra o grid de debug no lugar do asfalto (lil-gui) */
    debugGrid: false,

    palette: {
      skyTop: 0x070b1c,
      skyHorizon: 0x2b2148,
      fog: 0x1e1a33,
      asphalt: 0x2a2c31,
      asphaltDark: 0x24262b,
      asphaltLight: 0x33363b,
      asphaltGrain: 0x3a3d43,
      stallLine: 0xd6d3c6,
      laneLine: 0xd4ad3c,
      oil: 0x1b1c20,
      outerGround: 0x1f2125,
      concrete: 0x5b5f69,
      plywood: 0x3d4250,
      metal: 0x3b3f47,
      accent: 0xff2e88,
      lampLight: 0xffb766,
      lampHead: 0xffe3b3,
      skyline: 0x141329,
      windowWarm: 0xffcf7a,
      windowCool: 0x8fc8ff,
      fence: 0x4a4e57,
    },

    fog: { near: 18, far: 90 },

    sky: {
      radius: 260,
      widthSegments: 24,
      heightSegments: 12,
      /** seno da elevação onde a cor sai da névoa e vira a do horizonte */
      horizonBlend: 0.04,
      /** seno da elevação onde o céu chega à cor do topo */
      topBand: 0.45,
      exponent: 0.7,
    },

    lights: {
      hemiSky: 0x34406e,
      hemiGround: 0x15121c,
      hemiIntensity: 0.6,
      moonColor: 0xa9bcff,
      // unidades físicas do three: irradiância × albedo/π; ~2,6 deixa o moletom claro
      // (#E7E2D6) lendo como claro e o asfalto ainda a ~15% de valor
      moonIntensity: 2.6,
      /** atrás e à esquerda do spawn: ilumina o lado do skater que a câmera vê */
      moonOffsetX: -8,
      moonOffsetY: 20,
      moonOffsetZ: -12,
      /** contraluz magenta atrás do skater (em relação à câmera), sem sombra */
      rimColor: 0xff7ab8,
      rimIntensity: 1.2,
      rimDistance: 10,
      rimHeight: 3,
      /** meia largura da câmera de sombra, centrada no skater */
      shadowExtent: 12,
      shadowNear: 1,
      shadowFar: 60,
      shadowMapSize: 2048,
      shadowBias: -0.0004,
      shadowNormalBias: 0.02,
      /** poças de luz de sódio "assadas" no lightMap do chão */
      poolRadius: 9,
      /** expoente da queda de luz (espaço linear) e nº de paradas do gradiente */
      poolFalloff: 2,
      poolStops: 8,
      lightMapSize: 512,
      // alto porque o asfalto reflete pouco (albedo ~2%): é o que deixa a poça visível
      lightMapIntensity: 30,
    },

    ground: {
      textureSize: 1024,
      /** metros cobertos por um tile: metade vagas, metade corredor */
      tileMeters: 10,
      /** desloca o tile para x = 0 cair na faixa amarela do corredor */
      offsetMeters: 7.5,
      noiseDots: 25000,
      grains: 300,
      grainPx: 2,
      stallSpacing: 2.5,
      stallLength: 4.8,
      lineWidth: 0.1,
      laneWidth: 0.12,
      dashLength: 1.5,
      dashGap: 1.0,
      oilStains: 5,
      oilRadiusX: 0.3,
      oilRadiusZ: 0.5,
      oilAlpha: 0.6,
      /** fração do comprimento das linhas apagada pelo desgaste */
      wearFraction: 0.15,
      wearAlpha: 0.5,
      wearDotPx: 3,
      roughness: 1,
      /** variação de brilho por vértice para quebrar a repetição do tile */
      segments: 24,
      tintMin: 0.94,
      seed: 1337,
      /** moldura de chão externo até essa distância */
      outerSize: 400,
    },

    gridDebug: {
      textureSize: 1024,
      tileMeters: 8,
      colorA: 0x6f7780,
      colorB: 0x667079,
      minorLineColor: 0x7f8891,
      majorLineColor: 0x9da6ae,
      minorLineWidth: 3,
      majorLineWidth: 8,
    },

    kit: {
      roughness: 0.95,
      /** o corpo recua dentro da AABB para os acabamentos não passarem dela */
      bodyInset: 0.005,
      copingSize: 0.04,
      edgeStripWidth: 0.06,
      crateStripWidth: 0.05,
      stripHeight: 0.01,
      curbWidth: 0.15,
      curbHeight: 0.2,
      curbOffset: 0.025,
    },

    rail: {
      tubeRadius: 0.024,
      postRadius: 0.021,
      bendRadius: 0.1,
      postSpacing: 2,
      tubularSegments: 64,
      radialSegments: 8,
    },

    pole: {
      shaftRadius: 0.09,
      armLength: 1.5,
      armThickness: 0.08,
      headWidth: 0.3,
      headHeight: 0.12,
      headLength: 0.6,
      segments: 10,
      /** postes decorativos fora do limite do mapa (sem colisão) */
      boundaryOffset: 60.5,
      boundaryPositions: [-40, 0, 40],
    },

    fence: {
      height: 2.5,
      offset: 61,
      textureSize: 256,
      textureMeters: 2,
      cellMeters: 0.06,
      wirePx: 1.5,
      alphaTest: 0.5,
    },

    skyline: {
      count: 30,
      minRadius: 100,
      maxRadius: 180,
      minWidth: 10,
      maxWidth: 30,
      minDepth: 8,
      maxDepth: 20,
      minHeight: 8,
      maxHeight: 45,
      seed: 7,
      viaductZ: 110,
      viaductY: 8,
      viaductLength: 200,
      viaductThickness: 1.5,
      viaductDepth: 12,
      viaductPillars: 6,
      pillarSize: 1.5,
      windowCount: 400,
      windowWidth: 0.8,
      windowHeight: 1.2,
      windowWarmFraction: 0.7,
      /** margem das janelas até as bordas da fachada */
      windowMargin: 1.5,
      /** distância da janela à frente da fachada (evita z-fight) */
      windowOffset: 0.05,
    },

    board: {
      plankLength: 0.54,
      kickLength: 0.14,
      kickAngle: MathUtils.degToRad(18),
      thickness: 0.03,
      width: 0.2,
      /** folga entre o topo das rodas e o shape (trucks) */
      truckHeight: 0.025,
      truckWidth: 0.15,
      truckLength: 0.05,
      /** distância do centro do shape até o pivô do nose pop (tail) */
      tailPivot: 0.38,
      deckColor: 0x1a1a1f,
      truckColor: 0x6d717a,
    },

    wheels: {
      radius: 0.028,
      width: 0.032,
      trackHalf: 0.07,
      axleOffset: 0.27,
      segments: 12,
      /** rodas de LED: MeshBasic, funcionam como marcador do jogador */
      color: 0xff2e88,
    },

    /** Figurino C: moletom com capuz levantado, calça larga, mochila, cano alto. */
    outfit: {
      hoodie: 0xe7e2d6,
      hoodInside: 0x3a3936,
      pants: 0x6a6f79,
      shoe: 0x18181c,
      sole: 0xf2f2f2,
      skin: 0xc8946b,
      backpack: 0xb8bfcc,
      roughness: 0.9,
      radialSegments: 10,
      torsoShoulderRadius: 0.18,
      torsoHipRadius: 0.15,
      torsoHeight: 0.58,
      /** quanto o tronco desce abaixo da junta do quadril */
      torsoBelowHip: 0.06,
      /** achatamento do tronco na profundidade (eixo X, peito → costas) */
      torsoDepthScale: 0.64,
      backpackDepth: 0.12,
      backpackHeight: 0.34,
      backpackWidth: 0.26,
      backpackBack: 0.15,
      backpackTopDrop: 0.06,
      neckRadius: 0.055,
      hoodRadius: 0.125,
      hoodScaleX: 1.05,
      hoodScaleY: 1.08,
      hoodScaleZ: 0.95,
      hoodBack: 0.015,
      /** abertura escura do capuz (sem rosto) */
      openingX: -0.075,
      openingY: -0.015,
      openingRadiusX: 0.045,
      openingRadiusY: 0.085,
      openingRadiusZ: 0.07,
      upperArmRadius: 0.055,
      forearmRadius: 0.046,
      handRadius: 0.042,
      thighRadius: 0.08,
      shinRadius: 0.072,
      shoeLength: 0.27,
      shoeHeight: 0.11,
      shoeWidth: 0.115,
      soleLength: 0.285,
      soleHeight: 0.03,
      soleWidth: 0.12,
      /** o bico do tênis fica para −X (lado do peito) */
      shoeToeOffset: 0.06,
    },

    /** Rig do personagem (tabela R). Espaço do bodyPivot: origem no topo do shape, −X = peito. */
    rig: {
      ankleHeight: 0.08,
      ankleX: 0.04,
      stanceHalf: 0.21,
      thigh: 0.43,
      shin: 0.43,
      hipHalf: 0.09,
      spine: 0.5,
      shoulderDrop: 0.04,
      shoulderHalf: 0.19,
      neck: 0.1,
      headOffset: 0.12,
      upperArm: 0.3,
      forearm: 0.3,
      kneePoleX: -1,
      kneePoleZ: 0.03,
      frontToeYaw: MathUtils.degToRad(15),
      /** C: braços 0,8× mais fechados em Z */
      armSpreadZ: 0.8,
      airDamping: 12,
      grindDamping: 14,
      curveHandRise: 0.12,
      curveHandSpread: 0.05,
      poses: POSES,
    },

    /**
     * Tombo (só visual): o corpo vira um ragdoll de partículas (Verlet) partindo da pose atual
     * e o shape solta do pé como corpo rígido simples. Ao levantar, ambos voltam suavemente.
     */
    bail: {
      substep: 1 / 120,
      iterations: 10,
      gravity: 18,
      /** fração da velocidade mantida a cada subpasso (arrasto do ar) */
      airDrag: 0.998,
      /** fração do deslocamento horizontal perdida por subpasso em contato com o chão */
      groundFriction: 0.2,
      /** massa relativa: tronco pesa mais que os membros (o tronco puxa, os braços balançam) */
      torsoMass: 3,
      limbMass: 1,
      /** pés travam no chão ao pousar atravessado (o corpo tropeça por cima deles) */
      feetVelocityLanding: 0.25,
      /** batida de lado: pernas param no obstáculo, o tronco segue */
      feetVelocityImpact: 0,
      kneeVelocityImpact: 0.3,
      /** o quadril não se afasta mais que isso da posição da sim (mola suave) */
      anchorSlack: 0.6,
      anchorStiffness: 4,
      /** limites para o corpo não dobrar ao meio: frações do comprimento esticado */
      legFoldMin: 0.45,
      armFoldMin: 0.3,
      headBendMin: 0.82,
      headBendMax: 1.05,
      radiusHead: 0.12,
      radiusNeck: 0.08,
      radiusShoulder: 0.11,
      radiusHip: 0.11,
      radiusKnee: 0.07,
      radiusAnkle: 0.07,
      radiusElbow: 0.05,
      radiusHand: 0.045,
      /** levantar: do ragdoll de volta à pose em pé */
      getupDuration: 0.45,

      /** shape solto: segue o momento do tombo (perde parte no impacto), com um pop para cima e giro */
      boardKick: 1.0,
      boardPop: 2.2,
      boardSideJitter: 0.8,
      /** giro máximo (rad/s) em torno do eixo longo; em Y é essa fração */
      boardSpin: 10,
      boardYawSpinFactor: 0.5,
      /** batida de lado: o shape quica de volta da parede */
      boardWallRestitution: 0.4,
      boardRestitution: 0.3,
      /** rodas para baixo: rola (pouco atrito no sentido do shape, muito de lado) */
      boardWheelsDownCos: 0.8,
      /** maior que a do skater (rollingFriction): sem ninguém em cima o shape não vai longe */
      boardRollFriction: 2.5,
      boardLateralFriction: 10,
      /** de lado ou de cabeça para baixo: arrasta e para (menos que o corpo, que freia a 6) */
      boardSlideFriction: 3.5,
      boardContactSpinDamping: 6,
      /** quão rápido o shape assenta deitado (rodas para baixo ou para cima) */
      boardSettleRate: 8,
      /** raio do shape para colidir com a lateral das caixas */
      boardWallRadius: 0.2,
      /** volta do shape para o pé: mais longe = mais demorado e com arco mais alto */
      boardReturnDuration: 0.3,
      boardReturnPerMeter: 0.04,
      boardReturnArc: 0.3,
      boardReturnArcPerMeter: 0.08,
    },

    /**
     * Remada: o pé de trás sai do shape, pisa no chão do lado do peito, fica cravado no asfalto
     * enquanto o shape passa (empurrão) e volta para o tail. Frações são do ciclo inteiro.
     */
    push: {
      cycleDuration: 0.85,
      /** fim da ida do pé até o chão */
      reachEnd: 0.22,
      /** fim do contato com o chão (pode soltar antes, se o pé ficar para trás demais) */
      contactEnd: 0.62,
      /** onde o pé toca o chão, no espaço do bodyPivot (−X = lado do peito) */
      plantX: -0.22,
      plantZ: 0.06,
      /** o pé solta quando fica mais para trás que isso (antes de a perna esticar demais) */
      strokeMinZ: -0.4,
      liftReach: 0.1,
      liftRecover: 0.16,
      /** entrada e saída da pose de remada, como fração do ciclo */
      envelopeIn: 0.18,
      envelopeOut: 0.22,
      /** pausa entre remadas: nenhuma parado, até isso na velocidade máxima de remada */
      maxGap: 1.2,
      /** quão rápido a pose e o pé acompanham (e voltam, se a remada for interrompida) */
      followDamping: 20,
      /** pé da frente gira para apontar para o nose; o de trás aponta para a frente no chão */
      frontToeYaw: MathUtils.degToRad(65),
      backToeYaw: MathUtils.degToRad(80),
      /** de frente para o nose, os joelhos dobram para a frente */
      kneePoleF: [-0.3, 0, 1] as Vec3Tuple,
      kneePoleB: [-0.2, 0, 1] as Vec3Tuple,
      /** acima do pé, até onde um topo de caixa conta como chão para o pé que rema */
      groundTolerance: 0.1,
    },

    /** Visual dos flips e do agachamento antes do pop. */
    tricks: {
      /** o shape sobe em direção aos pés enquanto gira */
      boardLift: 0.12,
      /** os pés sobem e soltam do shape durante o giro */
      footLift: 0.14,
      /** entrada e saída dos pés soltos, como fração do flip */
      envIn: 0.15,
      envOut: 0.2,
      /** quanto da pose de agachamento entra ao segurar o pop */
      crouchWeight: 0.8,
      crouchDamping: 14,
      /** grab: o shape sobe até as mãos e o corpo encolhe (pose grab) */
      grabBoardLift: 0.32,
      grabDamping: 16,
      /** cotovelos apontam para fora/para trás ao alcançar o shape */
      grabElbowPoleF: [0.4, 0, 1] as Vec3Tuple,
      grabElbowPoleB: [0.4, 0, -1] as Vec3Tuple,
      /** onde cada mão pega o shape (espaço do shape; −X = lado dos dedos) */
      grabPoints: {
        melon: [0.1, 0, 0.08] as Vec3Tuple,
        nosegrab: [0, 0, 0.36] as Vec3Tuple,
        mute: [-0.1, 0, 0.08] as Vec3Tuple,
        indy: [-0.1, 0, -0.06] as Vec3Tuple,
        tailgrab: [0, 0, -0.36] as Vec3Tuple,
        stalefish: [0.1, 0, -0.06] as Vec3Tuple,
      },
      /** manual: inclinação do shape sobre o eixo das rodas, mais o balanço do equilíbrio */
      manualAngle: 0.22,
      manualWobble: 0.5,
      manualDamping: 14,
      /** powerslide: o skater e o shape ficam de lado */
      powerslideDamping: 12,
      /**
       * Pose do shape em cada grind: inclinação (pitch, + = nose para baixo), rolagem, giro em Y,
       * eixo de apoio ('rear'/'front' truck ou 'center') e deslocamento ao longo do shape.
       */
      grindPoses: {
        '5050': { pitch: 0, roll: 0, yaw: 0, pivot: 'center', shift: 0 },
        fiveO: { pitch: -0.22, roll: 0, yaw: 0, pivot: 'rear', shift: 0 },
        nosegrind: { pitch: 0.22, roll: 0, yaw: 0, pivot: 'front', shift: 0 },
        smith: { pitch: 0.25, roll: 0.35, yaw: 0, pivot: 'rear', shift: 0 },
        feeble: { pitch: 0.2, roll: -0.35, yaw: 0, pivot: 'rear', shift: 0 },
        crooked: { pitch: 0.2, roll: 0, yaw: 0.35, pivot: 'front', shift: 0 },
        boardslide: { pitch: 0, roll: 0, yaw: 0, pivot: 'center', shift: 0 },
        noseslide: { pitch: 0.12, roll: 0, yaw: 0, pivot: 'center', shift: -0.33 },
        tailslide: { pitch: -0.12, roll: 0, yaw: 0, pivot: 'center', shift: 0.33 },
        lipslide: { pitch: 0, roll: 0, yaw: 0, pivot: 'center', shift: 0 },
      } as Record<string, { pitch: number; roll: number; yaw: number; pivot: 'rear' | 'front' | 'center'; shift: number }>,
      grindPoseDamping: 16,
      /** o corpo inclina junto com o chão (rampas, corrimão de escada) */
      slopePitchDamping: 10,
    },

    /** HUD de pontuação */
    hud: {
      /** quanto tempo o nome da manobra fica na tela (s) */
      trickTime: 1.6,
      /** quanto tempo o resultado da linha (+pontos ou BAIL) fica na tela (s) */
      lineTime: 2.2,
      bestKey: 'sk8ordie.bestLine',
    },

    /** faíscas do grind */
    sparks: {
      count: 48,
      /** faíscas por segundo enquanto trilha */
      rate: 70,
      size: 0.03,
      life: 0.35,
      lifeJitter: 0.5,
      minSpeed: 1.5,
      maxSpeed: 3.5,
      spread: 1.6,
      lift: 1.8,
      gravity: 9,
    },

    juice: {
      /** inclinação máxima do corpo na curva (input × speed/maxSpeed) */
      leanMax: 0.45,
      leanDamping: 10,
      /** fração do lean aplicada ao shape */
      boardLeanFactor: 0.35,
      popAngle: 0.4,
      popDuration: 0.25,
      /** duração da pose de aterrissagem (quadril desce) */
      landCrouchDuration: 0.2,
      /** folga sobre o giro máximo por input antes de tratar como salto de yaw */
      yawSnapMargin: 1.5,
      /** velocidade com que o shape alcança o yaw da sim após um salto (snap/saída do grind) */
      yawSnapDamping: 18,
    },
  },
};

export type LoopConfig = typeof CONFIG.loop;
export type SimConfig = typeof CONFIG.sim;
export type WorldConfig = typeof CONFIG.world;
export type CameraConfig = typeof CONFIG.camera;
export type VisualConfig = typeof CONFIG.visual;
export type RigConfig = VisualConfig['rig'];
