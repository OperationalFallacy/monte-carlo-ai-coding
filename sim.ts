import * as fs from 'fs';
import * as stats from 'simple-statistics';
import * as vega from 'vega';
import type { Spec } from 'vega';
import { Canvas } from 'canvas';

/**
 * Represents statistical metrics for simulation results
 * Calculates various percentiles and averages for both AI-assisted and manual coding times
 */
interface SimulationStats {
    meanMinutes: number;
    medianMinutes: number;
    p90Minutes: number;
    p95Minutes: number;
    minMinutes: number;
    maxMinutes: number;
}

class CodingTimeSimulator {
    constructor(
        private mu: number = 0.9,
        private sigma: number = 1.0,
        private readinessMean: number = 0.8,
        private readinessStd: number = 0.05,
        private waitTimeMean: number = 20,
        private waitTimeStd: number = 3,
        private retryImpact: number = 0.05,
        private linesOfCode: number = 100,
        private retryPower: number = 1.0,
        private maxMinutes: number = 0,  // 0 means no limit
        private _useLogScale: boolean = false
    ) {}

    get useLogScale(): boolean {
        return this._useLogScale;
    }

    private drawRetryCount(): number {
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return Math.exp(this.mu + this.sigma * z);
    }

    private drawWaitTime(): number {
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return Math.max(1, this.waitTimeMean + this.waitTimeStd * z);
    }

    private drawReadiness(): number {
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return Math.max(0.5, Math.min(1, this.readinessMean + this.readinessStd * z));
    }

    private simulateTime(): number {
        const W = this.drawWaitTime();
        const N = this.drawRetryCount();
        const R = this.drawReadiness();
        return W * N * (1 + this.retryImpact * Math.pow(N, this.retryPower)) * (this.linesOfCode / (R * 60));
    }

    runSimulation(numSimulations: number = 30000): number[] {
        return Array.from({ length: numSimulations }, () => this.simulateTime());
    }

    public static calculateStats(times: number[]): SimulationStats {
        const sorted = [...times].sort((a, b) => a - b);
        const n = sorted.length;
        
        return {
            meanMinutes: stats.mean(times),
            medianMinutes: stats.median(sorted),
            p90Minutes: sorted[Math.floor(n * 0.9)],
            p95Minutes: sorted[Math.floor(n * 0.95)],
            minMinutes: sorted[0],
            maxMinutes: sorted[n-1]
        };
    }

    async plotDistribution(times: number[], useLogScale: boolean): Promise<void> {
        const stats = CodingTimeSimulator.calculateStats(times);
        const filteredTimes = this.maxMinutes > 0 ? times.filter(t => t <= this.maxMinutes) : times;
        const maxTime = this.maxMinutes > 0 ? this.maxMinutes : Math.max(...filteredTimes);
        const minTime = Math.max(1, Math.min(...filteredTimes));

        const spec: Spec = {
            $schema: 'https://vega.github.io/schema/vega/v5.json',
            width: 1200,
            height: 700,
            padding: 20,
            background: 'white',
            title: {
                text: `AI Code Generation Time Distribution (N=${times.length}) ${useLogScale ? 'log scale' : 'linear scale'}`,
                subtitle: [
                    `Parameters: AI success rate (Normal): ${this.readinessMean*100}% mean, AI retries (Log-normal): ${Math.exp(this.mu).toFixed(1)} mean, AI response time (Normal): ${this.waitTimeMean}s mean`,
                    `Expected time to generate ${this.linesOfCode} LOC, min:`,
                    `Time range: ${Math.round(stats.minMinutes)}-${Math.round(stats.maxMinutes)}`,
                    `Mean: ${Math.round(stats.meanMinutes)}`,
                    `Median: ${Math.round(stats.medianMinutes)}`,
                    `P90-P95: ${Math.round(stats.p90Minutes)}-${Math.round(stats.p95Minutes)}`
                ],
                fontSize: 16,
                subtitleFontSize: 14,
                anchor: 'start',
                offset: 10
            },
            data: [
                {
                    name: 'table',
                    values: filteredTimes.map(t => ({ data: t })),
                    transform: useLogScale ? [
                        {
                            type: 'formula',
                            expr: 'log(datum.data)',
                            as: 'log_data'
                        },
                        {
                            type: 'bin',
                            field: 'log_data',
                            extent: [Math.log(minTime), Math.log(maxTime)],
                            maxbins: 100,
                            as: ['bin0', 'bin1']
                        },
                        {
                            type: 'formula',
                            expr: 'exp(datum.bin0)',
                            as: 'bin0_exp'
                        },
                        {
                            type: 'formula',
                            expr: 'exp(datum.bin1)',
                            as: 'bin1_exp'
                        },
                        {
                            type: 'aggregate',
                            groupby: ['bin0_exp', 'bin1_exp'],
                            ops: ['count'],
                            as: ['count']
                        }
                    ] : [
                        {
                            type: 'bin',
                            field: 'data',
                            extent: [0, maxTime],
                            maxbins: 100,
                            as: ['bin0', 'bin1']
                        },
                        {
                            type: 'aggregate',
                            groupby: ['bin0', 'bin1'],
                            ops: ['count'],
                            as: ['count']
                        }
                    ]
                }
            ],
            scales: [
                {
                    name: 'x',
                    type: useLogScale ? 'log' : 'linear',
                    base: useLogScale ? Math.E : undefined,
                    domain: useLogScale ? [minTime, maxTime] : [0, maxTime],
                    range: 'width',
                    nice: true
                },
                {
                    name: 'y',
                    type: 'linear',
                    domain: { data: 'table', field: 'count' },
                    range: 'height',
                    nice: true,
                    zero: true
                }
            ],
            marks: [
                {
                    type: 'rect',
                    from: { data: 'table' },
                    encode: {
                        update: {
                            x: { scale: 'x', field: useLogScale ? 'bin0_exp' : 'bin0' },
                            x2: { scale: 'x', field: useLogScale ? 'bin1_exp' : 'bin1' },
                            y: { scale: 'y', field: 'count' },
                            y2: { scale: 'y', value: 0 },
                            fill: { value: '#4682b4' }
                        }
                    }
                }
            ],
            axes: [
                {
                    scale: 'x',
                    orient: 'bottom',
                    title: 'Time (minutes)',
                    grid: false,
                    format: 'd'
                },
                {
                    scale: 'y',
                    orient: 'left',
                    title: 'Count',
                    grid: false
                }
            ]
        };

        const view = new vega.View(vega.parse(spec), { renderer: 'none' });
        const canvas = await view.toCanvas();
        const nodeCanvas = canvas as unknown as Canvas;
        const filename = `media/sim_r${this.readinessMean}_w${this.waitTimeMean}_mu${this.mu}_s${this.sigma}_i${this.retryImpact}_p${this.retryPower}_${this._useLogScale ? 'log' : 'linear'}.png`;
        const stream = nodeCanvas.createPNGStream();
        const out = fs.createWriteStream(filename);
        stream.pipe(out);
    }

    async plotCumulativeDistribution(times: number[], useLogScale: boolean): Promise<void> {
        const filteredTimes = this.maxMinutes > 0 ? 
            times.filter(t => t <= this.maxMinutes).sort((a, b) => a - b) : 
            times.sort((a, b) => a - b);
        const maxTime = this.maxMinutes > 0 ? this.maxMinutes : Math.max(...filteredTimes);
        const minTime = Math.max(1, Math.min(...filteredTimes));
        const stats = CodingTimeSimulator.calculateStats(times);

        const spec: Spec = {
            $schema: 'https://vega.github.io/schema/vega/v5.json',
            width: 1200,
            height: 700,
            padding: 20,
            background: 'white',
            title: {
                text: `AI Code Generation Time Cumulative Distribution (N=${times.length})`,
                subtitle: [
                    `Parameters: AI success rate (Normal): ${this.readinessMean*100}% mean, AI retries (Log-normal): ${Math.exp(this.mu).toFixed(1)} mean, AI response time (Normal): ${this.waitTimeMean}s mean`,
                    `Expected time to generate ${this.linesOfCode} LOC, min`,
                    `Time range: ${Math.round(stats.minMinutes)} - ${Math.round(stats.maxMinutes)}`,
                    `Mean: ${Math.round(stats.meanMinutes)}`,
                    `Median: ${Math.round(stats.medianMinutes)}`,
                    `P90-P95: ${Math.round(stats.p90Minutes)} - ${Math.round(stats.p95Minutes)}min`
                ],
                fontSize: 16,
                subtitleFontSize: 14,
                anchor: 'start',
                offset: 10
            },
            data: [
                {
                    name: 'table',
                    values: filteredTimes.map((t, i) => ({ 
                        time: t,
                        cumulative_count: i + 1
                    }))
                }
            ],
            scales: [
                {
                    name: 'x',
                    type: useLogScale ? 'log' : 'linear',
                    base: useLogScale ? Math.E : undefined,
                    domain: useLogScale ? [minTime, maxTime] : [0, maxTime],
                    range: 'width',
                    nice: true,
                    zero: false
                },
                {
                    name: 'y',
                    type: 'linear',
                    domain: [0, filteredTimes.length],
                    range: 'height',
                    nice: true,
                    zero: true
                }
            ],
            marks: [
                {
                    type: 'line',
                    from: { data: 'table' },
                    encode: {
                        update: {
                            x: { scale: 'x', field: 'time' },
                            y: { scale: 'y', field: 'cumulative_count' },
                            stroke: { value: '#4682b4' },
                            strokeWidth: { value: 2 }
                        }
                    }
                }
            ],
            axes: [
                {
                    scale: 'x',
                    orient: 'bottom',
                    title: 'Time (minutes)',
                    grid: false,
                    format: 'd'
                },
                {
                    scale: 'y',
                    orient: 'left',
                    title: 'Cumulative Count',
                    grid: false
                }
            ]
        };

        const view = new vega.View(vega.parse(spec), { renderer: 'none' });
        const canvas = await view.toCanvas();
        const nodeCanvas = canvas as unknown as Canvas;
        const filename = `media/sim_cumulative_r${this.readinessMean}_w${this.waitTimeMean}_mu${this.mu}_s${this.sigma}_i${this.retryImpact}_p${this.retryPower}_${this._useLogScale ? 'log' : 'linear'}.png`;
        const stream = nodeCanvas.createPNGStream();
        const out = fs.createWriteStream(filename);
        stream.pipe(out);
    }
}

/**
 * Prints a formatted report of simulation parameters and results
 * Uses simple string formatting for clear aligned output
 */
function printSimulationReport(simulator: CodingTimeSimulator, times: number[]): void {
    const stats = CodingTimeSimulator.calculateStats(times);
    
    const parameterDescriptions = {
        mu: `\nMean (μ) of log-normal AI retries. How many retries AI makes before success.
AI takes exponentially longer when it fails early. +1 → ~2.7× median retries\n`,
    
        sigma: `\nStd (σ) of log-normal AI retries. Adjusts retry variability.
+0.5 → ~1.6× IQR. Wider spread means AI sometimes fails quickly, sometimes loops longer.\n`,
    
        waitTimeMean: `\nMean (W) AI task generation time. Base time AI takes per attempt.
+10s → ~+50% mean total time. Higher values slow down every retry.\n`,
    
        waitTimeStd: `\nStd (σ_w) AI task generation time. Adds randomness to AI response times.
+3s → more variance in completion time, but doesn't affect median much.\n`,
    
        retryImpact: `\nMultiplicative retry delay (α). Increases slowdown per retry.
+0.05 → +5% per retry, compounding delays. Makes AI struggle more on hard tasks.\n`,
    
        retryPower: `\nRetry scaling exponent (p). Controls how retry impact grows.
1.0 = linear, 2.0 = quadratic. Higher values punish repeated failures more.\n`,
    
        linesOfCode: `\nTask size (LOC). Number of lines AI is generating.
+100 → ~+100% time increase, but retries scale worse with larger tasks.\n`,
    
        readinessMean: `\nMean AI success rate (R). Fraction of code AI gets right per attempt.
-0.1 → ~1.25× retries needed. AI retries more when lower.\n`,
    
        readinessStd: `\nStd (σ_r) AI success rate. Increases randomness in AI's effectiveness.
+0.05 → AI alternates between good and bad completions more.\n`
    };

    process.stdout.write("\n=== Simulation Parameters ===\n\n");
    
    Object.entries(parameterDescriptions).forEach(([param, desc]) => {
        const value = simulator[param as keyof CodingTimeSimulator];
        process.stdout.write(`${param.padEnd(15)} = ${String(value).padEnd(6)} | ${desc}\n`);
    });

    process.stdout.write("\n=== Simulation Results ===\n\n");
    
    const results: Array<[string, number]> = [
        ["Mean", stats.meanMinutes],
        ["Median", stats.medianMinutes],
        ["90th %ile", stats.p90Minutes],
        ["95th %ile", stats.p95Minutes],
        ["Min", stats.minMinutes],
        ["Max", stats.maxMinutes]
    ];

    results.forEach(([label, value]) => {
        process.stdout.write(`${label.padEnd(12)}: ${Math.round(value)} minutes\n`);
    });
    
    process.stdout.write("\n");
}

async function main(): Promise<void> {
    const baseSimulator = new CodingTimeSimulator(
        0.9,    // mu
        0.5,    // sigma
        0.8,    // readinessMean
        0.05,   // readinessStd
        20,     // waitTimeMean
        3,      // waitTimeStd
        0.05,   // retryImpact
        100,    // linesOfCode
        1.0,    // retryPower
        0,      // maxMinutes (0 = no limit)
        false   // useLogScale
    );

    const times = baseSimulator.runSimulation(1000);
    printSimulationReport(baseSimulator, times);

    await baseSimulator.plotDistribution(times, baseSimulator.useLogScale);
    await baseSimulator.plotCumulativeDistribution(times, baseSimulator.useLogScale);
}

main();

/**
 * rules for cursor and other ai:
 * Do not print ANY SUMMARIES in the chat!
 * For charting you must use vega library and nothing else
 * you must not try to manually plot, bin, draw and do other shit. Library must do maximum heavy lifting.
*/