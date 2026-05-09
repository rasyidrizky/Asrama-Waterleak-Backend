const swaggerAutogen = require('swagger-autogen')();

const doc = {
  info: {
    title: 'API Deteksi Kebocoran Air',
    description: 'Dokumentasi otomatis API IoT dan Dashboard Pengelola'
  },
  host: 'localhost:5000',
  schemes: ['http'],
  securityDefinitions: {
    bearerAuth: {
      type: 'apiKey',
      in: 'header',
      name: 'Authorization',
      description: 'Masukkan token JWT dengan format: Bearer <token>'
    }
  }
};

const outputFile = './swagger.json';
const routes = ['./src/server.js']; 

swaggerAutogen(outputFile, routes, doc);