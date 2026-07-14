export interface FlowerTypeDef {
	name: string;
	model: string;
	color: string;
	count: number;
	baseScale: number;
	scaleRange: [number, number];
}

export const BLUMEN: FlowerTypeDef[] = [
	{
		name: "Alba Armeria",
		model: "/models/blumen/glb_Alba_Armeria_Spring_Pink.glb",
		color: "#ff6b9d",
		count: 25,
		baseScale: 0.025,
		scaleRange: [0.5, 1.5],
	},
	{
		name: "Spider Lily",
		model: "/models/blumen/spider_lily_lycoris_radiata.glb",
		color: "#e74c3c",
		count: 25,
		baseScale: 1.7,
		scaleRange: [0.6, 1.6],
	},
	{
		name: "Lungwort",
		model: "/models/blumen/Lungwort Spring.glb",
		color: "#ff9ff3",
		count: 25,
		baseScale: 0.025,
		scaleRange: [0.5, 1.5],
	},
];
