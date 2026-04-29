import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middleware/auth.js";
import { generateTicketCode, generateQRData } from "../lib/qr.js";

const router = Router();

/**
 * POST /api/events/:eventId/waitlist
 * - Require authentication
 * - Event must exist and be sold out
 * - User must not already be CONFIRMED or WAITLISTED for this event
 * - Create WAITLISTED booking without capacity increment
 * - Compute position as count of earlier WAITLISTED bookings + 1
 */
router.post("/:eventId/waitlist", authenticate, async (req, res) => {
  try {
    const eventId = req.params.eventId as string;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        error: "NOT_FOUND",
        message: "Event not found",
      });
    }

    if (event.soldCount < event.capacity) {
      return res.status(400).json({
        success: false,
        error: "NOT_SOLD_OUT",
        message: "Event is not sold out",
      });
    }

    // Prevent duplicate confirmed or waitlisted registrations
    const existing = await prisma.booking.findFirst({
      where: {
        userId: req.user!.userId,
        eventId,
        status: { in: ["CONFIRMED", "WAITLISTED"] },
      },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: "ALREADY_REGISTERED",
        message: "Already registered for this event",
      });
    }

    const ticketCode = generateTicketCode();
    const qrCodeData = generateQRData(ticketCode);

    const booking = await prisma.booking.create({
      data: {
        ticketCode,
        qrCodeData,
        userId: req.user!.userId,
        eventId,
        seatTierId: null,
        promoCodeId: null,
        pricePaid: 0,
        discountAmount: 0,
        status: "WAITLISTED",
      },
    });

    const aheadCount = await prisma.booking.count({
      where: {
        eventId,
        status: "WAITLISTED",
        createdAt: { lt: booking.createdAt },
      },
    });

    const position = aheadCount + 1;

    return res.status(201).json({
      success: true,
      data: { booking, position },
      message: "Added to waitlist",
    });
  } catch (error) {
    console.error("Error joining waitlist:", error);
    return res.status(500).json({
      success: false,
      error: "INTERNAL_ERROR",
      message: "Failed to join waitlist",
    });
  }
});

/**
 * GET /api/events/:eventId/waitlist/position
 * - Require authentication
 * - Return user's waitlist position and bookingId
 */
router.get("/:eventId/waitlist/position", authenticate, async (req, res) => {
  try {
    const eventId = req.params.eventId as string;

    const booking = await prisma.booking.findFirst({
      where: {
        userId: req.user!.userId,
        eventId,
        status: "WAITLISTED",
      },
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: "NOT_ON_WAITLIST",
        message: "Not on waitlist",
      });
    }

    const aheadCount = await prisma.booking.count({
      where: {
        eventId,
        status: "WAITLISTED",
        createdAt: { lt: booking.createdAt },
      },
    });

    const position = aheadCount + 1;

    return res.json({
      success: true,
      data: { position, bookingId: booking.id },
    });
  } catch (error) {
    console.error("Error fetching waitlist position:", error);
    return res.status(500).json({
      success: false,
      error: "INTERNAL_ERROR",
      message: "Failed to get waitlist position",
    });
  }
});

/**
 * DELETE /api/events/:eventId/waitlist
 * - Require authentication
 * - Remove user's WAITLISTED booking for the event
 */
router.delete("/:eventId/waitlist", authenticate, async (req, res) => {
  try {
    const eventId = req.params.eventId as string;

    const booking = await prisma.booking.findFirst({
      where: {
        userId: req.user!.userId,
        eventId,
        status: "WAITLISTED",
      },
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: "NOT_ON_WAITLIST",
        message: "Not on waitlist",
      });
    }

    await prisma.booking.delete({
      where: { id: booking.id },
    });

    return res.json({
      success: true,
      message: "Removed from waitlist",
    });
  } catch (error) {
    console.error("Error leaving waitlist:", error);
    return res.status(500).json({
      success: false,
      error: "INTERNAL_ERROR",
      message: "Failed to leave waitlist",
    });
  }
});

export default router;
