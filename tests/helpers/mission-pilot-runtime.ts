import { createMissionPilotRouter } from "@nightworkers/mission-pilot/backend";
import { createMissionPilotDependencies } from "../../api/composition/mission-pilot";

createMissionPilotRouter(createMissionPilotDependencies());
