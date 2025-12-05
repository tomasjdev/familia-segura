require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

(async () => {
  try {
    // Admin
    const email = "admin@demo.com";
    const exists = await prisma.user.findUnique({ where: { email } });
    if (!exists) {
      const hash = await bcrypt.hash("Passw0rd!", 10);
      await prisma.user.create({
        data: { email, password: hash, role: "ADMIN", sosEnabled: false }
      });
      console.log("Admin creado:", email, "/ Passw0rd!");
    } else {
      console.log("Admin ya existe:", email);
    }

    // Usuario demo + paciente de ejemplo
    const user = await prisma.user.upsert({
      where: { email: "user@demo.com" },
      update: {},
      create: { email: "user@demo.com", password: await bcrypt.hash("Passw0rd!", 10), role: "USER", sosEnabled: true }
    });

    const p = await prisma.patient.create({
      data: {
        name: "Juan Pérez",
        age: 78,
        condition: "Hipertensión",
        phone: "+56 9 1234 5678",
        ownerId: user.id,
        allergies: { create: [{ nombre: "Penicilina" }, { nombre: "Polen" }] },
        contacts: { create: [{ nombre: "María P.", parentesco: "Hija", telefono: "+56 9 2222 3333", prioridad: 1 }] },
        companion: { create: { nombre: "Carlos Pérez", telefono: "+56 9 4444 5555", email: "carlos@example.com" } }
      }
    });

    await prisma.device.create({
      data: { code: "GPS-0001", batteryPct: 85, isConnected: true, patientId: p.id }
    });

    await prisma.alert.create({
      data: { type: "SOS", status: "ACTIVE", patientId: p.id }
    });

    await prisma.track.createMany({
      data: [
        { patientId: p.id, lat: -33.45, lng: -70.67 },
        { patientId: p.id, lat: -33.452, lng: -70.665 }
      ]
    });

    console.log("Seed OK");
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
})();
