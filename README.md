# 🌐 Packet Stones — Simulador de Redes Educativo

Simulador de redes informáticas ejecutable en el navegador, similar a Cisco Packet Tracer pero simplificado y moderno. Desarrollado con React + TypeScript + Vite.

---

## 🚀 Instalación y arranque

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar en modo desarrollo
npm start
```

La app estará disponible en **http://localhost:3000**

### Para producción:
```bash
cd frontend
npm run build   # genera dist/
npm run preview # previsualiza el build
```

---

## 📁 Estructura del proyecto

```
packet-stones/
├── package.json                  # Scripts raíz (npm install / npm start)
├── README.md
│
├── frontend/                     # Aplicación React/TypeScript
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx              # Punto de entrada
│       ├── App.tsx               # Layout principal
│       ├── styles.css            # Estilos globales
│       │
│       ├── types/
│       │   └── network.ts        # Tipos TypeScript (Device, Link, Packet...)
│       │
│       ├── engine/
│       │   ├── store.ts          # Estado global (Zustand)
│       │   ├── NetworkEngine.ts  # Motor de simulación principal
│       │   └── algorithms/
│       │       ├── NetworkUtils.ts   # IP, MAC, máscaras
│       │       └── RoutingEngine.ts  # Longest-prefix match, RIP básico
│       │
│       └── components/
│           ├── canvas/
│           │   └── NetworkCanvas.tsx  # Canvas HTML5 interactivo
│           ├── panels/
│           │   ├── LeftPanel.tsx      # Herramientas y dispositivos
│           │   ├── RightPanel.tsx     # Config del dispositivo seleccionado
│           │   └── LogPanel.tsx       # Log de simulación
│           └── ui/
│               └── Toolbar.tsx        # Barra superior
│
└── shared/                       # Tipos compartidos (futuro backend)
```

---

## 🖥️ Uso de la aplicación

### 1. Crear dispositivos
- Haz clic en **Router**, **Switch** o **PC** en el panel izquierdo
- O arrástralos al canvas

### 2. Conectar dispositivos
- Selecciona la herramienta **🔌 Cable**
- Haz clic en el dispositivo origen
- Haz clic en el dispositivo destino
- Se crea el enlace automáticamente

### 3. Configurar dispositivos
- Selecciona un dispositivo con la herramienta **🖱️ Seleccionar**
- En el panel derecho configura:
  - **Hostname**
  - **IPs de las interfaces**
  - **Gateway por defecto** (PCs)
  - **Tabla de rutas** (Routers)

### 4. Simular tráfico
- Selecciona un **PC**
- En el panel derecho, escribe la IP destino y pulsa **▶**
- Observa el paquete moviéndose por el canvas
- Revisa el **log inferior** para ver el recorrido hop a hop

### 5. Simular fallos
- Selecciona un enlace → **⬇️ Bajar enlace**
- Selecciona un dispositivo → **⬇️ Apagar**
- Ajusta la **pérdida de paquetes** (%) en la config del enlace

### 6. Guardar/Cargar topología
- Barra superior → **💾 Guardar** → descarga JSON
- Barra superior → **📂 Cargar** → abre un JSON guardado

---

## 🏗️ Arquitectura del sistema

### Motor de simulación (`NetworkEngine.ts`)

El motor es una clase con sistema de eventos propio. El flujo de un ping:

```
PC1.sendPing("192.168.2.10")
  → NetworkEngine.ping()
    → routePacket(PC1, "192.168.2.10")
      → sendToGateway() → [animación en enlace PC1-Switch]
        → switchForward() → [animación en enlace Switch-Router]
          → routerForward() → findBestRoute() → [animación en enlace Router-PC2]
            → Destino alcanzado ✓
```

### Estado global (`store.ts` con Zustand)

```typescript
// Acceder al estado
const { devices, links, packets } = useStore();

// Acciones
const { addDevice, addLink, sendPing } = useStore();
```

### Algoritmo de enrutamiento

Implementado en `RoutingEngine.ts`:
- **Longest-prefix match**: selecciona la ruta más específica
- **Rutas directamente conectadas**: se calculan automáticamente al configurar IPs
- **Rutas estáticas**: añadibles manualmente desde el panel
- **RIP simplificado** (`propagateRip`): propaga rutas entre routers con metric+1

---

## 📡 Dispositivos y capacidades

| Dispositivo | L2 | L3 | DHCP | Ping | Config |
|------------|----|----|------|------|--------|
| PC         | ✓  | -  | ✓    | ✓    | IP, GW |
| Switch     | ✓  | -  | -    | -    | MAC table |
| Router     | ✓  | ✓  | ✓    | -    | Rutas, interfaces |

---

## 🎨 Topología de ejemplo

Al pulsar **"Cargar ejemplo"** se crea:

```
PC1 (192.168.1.10/24, gw: .1.1)
    |
  Switch1
    |
  Router1 (Gi0/0: 192.168.1.1, Gi0/1: 192.168.2.1)
    |
  ┌─┴─────────┐
PC2           PC3
(192.168.2.10) (192.168.2.20)
```

---

## ⚠️ Decisiones de diseño y limitaciones conocidas

1. **Sin backend**: toda la simulación es client-side. No hay persistencia de servidor. Se optó por esto para facilitar el despliegue (GitHub Pages, etc.).

2. **ARP simplificado**: el simulador omite el proceso ARP completo. Los paquetes se enrutan directamente. En una versión v2 se podría añadir una fase ARP antes del forwarding.

3. **Switch simplificado**: el switch hace flood en todos los puertos (broadcast). No implementa VLAN ni STP.

4. **RIP experimental**: `propagateRip()` está implementado pero no se llama automáticamente en el bucle de simulación. Se puede invocar manualmente desde el motor.

5. **IPv4 únicamente**: no hay soporte para IPv6.

6. **Un enlace por par**: no se permiten enlaces redundantes entre los mismos dos dispositivos (de momento).

---

## 🔧 Posibles mejoras (v2)

- [ ] Protocolo ARP completo con animación
- [ ] VLAN en switches
- [ ] Spanning Tree Protocol (STP)
- [ ] OSPF simplificado
- [ ] Modo paso a paso (step-by-step)
- [ ] Exportar topología como imagen PNG
- [ ] Backend Node.js + WebSockets para simulación multiusuario
- [ ] Subredes automáticas y VLSM
- [ ] IPv6
- [ ] Importar topologías GNS3

---

## 📚 Conceptos que enseña

- **Redes LAN**: topologías estrella, bus, árbol
- **Switching L2**: forwarding, broadcast, tabla MAC
- **Routing L3**: tabla de rutas, next-hop, longest-prefix match
- **ICMP**: ping, echo request/reply, TTL
- **Diagnóstico**: fallos de enlace, pérdida de paquetes, congestión
- **Subnetting**: máscaras, redes, gateways

---

## 📄 Licencia

MIT — libre para uso educativo y personal.
