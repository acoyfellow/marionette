import type { AnyPage } from "../kit";
import { balancerPage } from "./balancer";
import { cachePage } from "./cache";
import { cruisePage } from "./cruise";
import { drawbridgePage } from "./drawbridge";
import { dronePage } from "./drone";
import { drumsPage } from "./drums";
import { elevatorPage } from "./elevator";
import { firefliesPage } from "./fireflies";
import { garagePage } from "./garage";
import { insulinPage } from "./insulin";
import { lifePage } from "./life";
import { ovenPage } from "./oven";
import { pacemakerPage } from "./pacemaker";
import { parkingPage } from "./parking";
import { pinballPage } from "./pinball";
import { plantPage } from "./plant";
import { queuePage } from "./queue";
import { railwayPage } from "./railway";
import { safePage } from "./safe";
import { sorterPage } from "./sorter";
import { survivalPage } from "./survival";
import { thermostatPage } from "./thermostat";
import { vendingPage } from "./vending";
import { wafPage } from "./waf";
import { washerPage } from "./washer";

export const PAGES: readonly AnyPage[] = [
	survivalPage,
	dronePage,
	railwayPage,
	firefliesPage,
	cachePage,
	sorterPage,
	balancerPage,
	queuePage,
	wafPage,
	elevatorPage,
	thermostatPage,
	cruisePage,
	pacemakerPage,
	insulinPage,
	lifePage,
	vendingPage,
	washerPage,
	garagePage,
	parkingPage,
	drawbridgePage,
	plantPage,
	ovenPage,
	pinballPage,
	drumsPage,
	safePage,
];
