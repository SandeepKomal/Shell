````
sudo chmod +x file_name.sh
`````

`````
./file_name.sh
`````



`````
crontab
`````


`````
crontab -l
`````

`````
crontab -e
add this line 
* * * * * /root/docker_autoclean.sh >> /var/log/docker_autoclean.log 2>&1

`````

`````
crontab -l
`````

