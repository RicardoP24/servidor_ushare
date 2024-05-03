const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
require('dotenv').config();
const secretKey = process.env.JWT_SECRET; // Use default key if not provided in the environment

// Configuração do pool de conexão com o PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  // ssl: {
  //   // You can specify SSL options here
  //   //rejectUnauthorized: true, // Set to true to reject unauthorized connections
  //   // Optionally, you can provide SSL certificate details
  //   // For example:
  //    ca: fs.readFileSync('./certificadoSSL/global-bundle.pem'), // Path to CA certificate file
  //   // cert: fs.readFileSync('/path/to/client-certificate.crt'), // Path to client certificate file
  //   // key: fs.readFileSync('/path/to/client-key.key'), // Path to client key file
  // },
});

// Middleware para parsear o corpo da requisição como JSON
app.use(express.json());
app.use(cors());
app.use('/healthcheck', async (req, res) => {
  res.status(200).send('ok');
});
// Rota para login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Consulta ao banco de dados para obter o usuário pelo e-mail
    const query = 'SELECT * FROM Utilizador WHERE email = $1';
    const result = await pool.query(query, [email]);

    // Verifica se o usuário foi encontrado
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];

    // Verifica se a senha está correta
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    // Gera o token JWT
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);

    res.status(200).json({ token });
  } catch (error) {
    console.error('Erro ao fazer login:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});
app.get('/protected', verifyToken, (req, res) => {
  const userId = req.user.id;

  res.json({id:userId ,message: 'This is a protected route' });
});

app.post('/register', async (req, res) => {
  const { nome, tipoUser, email, password, coordenadasMorada, id_dist, id_munic, nif } = req.body;

  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    const query = `
      INSERT INTO Utilizador (nome, tipoUser, email, password, coordenadasMorada, id_dist, id_munic, nif)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const values = [nome, tipoUser, email, hashedPassword, coordenadasMorada, id_dist, id_munic, nif];

    const result = await pool.query(query, values);

    const token = jwt.sign({ id: result.rows[0].id }, process.env.JWT_SECRET);

    res.status(201).json({ ...result.rows[0], token: token });



  } catch (err) {
    console.error('Erro ao registrar usuário:', err);
    res.status(500).send('Erro interno do servidor');
  }
});

function verifyToken(req, res, next) {
  const token = req.headers['authorization'];


  if (!token) {
    return res.status(403).json({ message: 'Token not provided' });
  }

  jwt.verify(token, secretKey, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    req.user = decoded;
    next();
  });
}

app.get('/distritos', async (req, res) => {
  try {
    const query = 'SELECT * FROM Distritos;';
    const result = await pool.query(query);

    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao obter distritos:', err);
    res.status(500).send('Erro interno do servidor');
  }
});

// Rota para obter todos os municípios
app.get('/municipios', async (req, res) => {
  try {
    const query = 'SELECT * FROM Municipio;';
    const result = await pool.query(query);

    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao obter municípios:', err);
    res.status(500).send('Erro interno do servidor');
  }
});


app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);

});
