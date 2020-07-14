import { Request, Response } from "express";
import { Maybe } from "tsmonad";
import { MagdaUser } from "../authorization-api/model";
const jwt = require("jsonwebtoken");

declare global {
    namespace Express {
        interface User extends MagdaUser {}
    }
}

export function getUserId(req: Request, jwtSecret: string): Maybe<string> {
    const jwtToken = req.header("X-Magda-Session");

    if (jwtToken) {
        return getUserIdFromJwtToken(jwtToken, jwtSecret);
    } else {
        if (req.user?.id) {
            return Maybe.just(req.user.id);
        }
        return Maybe.nothing<string>();
    }
}

// Used by external projects
export function getUserIdFromJwtToken(jwtToken: string, jwtSecret: string) {
    try {
        const jwtPayload = jwt.verify(jwtToken, jwtSecret);
        return Maybe.just(jwtPayload.userId as string);
    } catch (e) {
        console.error(e);
        return Maybe.nothing<string>();
    }
}

export function getUserIdHandling(
    req: Request,
    res: Response,
    jwtSecret: string,
    cb: (userId: string) => void
) {
    const userId = getUserId(req, jwtSecret);

    userId.caseOf({
        just: (userId) => {
            cb(userId);
        },
        nothing: () => {
            console.warn(
                "Rejecting with not authorized because no user id present"
            );
            res.status(401).send("Not authorized.");
        }
    });
}
