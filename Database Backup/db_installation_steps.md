## Installation

Install MySQL:
```
sudo apt install mysql-server
```
Set up MySQL password:
```
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY
'root';
FLUSH PRIVILEGES;
```
